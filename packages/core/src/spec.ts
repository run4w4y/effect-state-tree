import { Result, Schema, SchemaAST } from 'effect'
import { uniqBy } from 'es-toolkit/array'

import type { EntityIdentity } from './errors'
import { getAtPath, type TreePath } from './path'
import {
  type AtomicInterpreter,
  isPlainObject,
  type SnapshotOptions,
} from './snapshot'

/** Effect Schema annotation key used for stable tree entity identity. */
export const EntityAnnotationKey = '@effect-state-tree/entity' as const
/** Effect Schema annotation key used to stop structural tree traversal. */
export const AtomicAnnotationKey = '@effect-state-tree/atomic' as const
/** Effect Schema annotation key used by CRDT adapters for native text nodes. */
export const CollaborativeTextAnnotationKey =
  '@effect-state-tree/collaborative-text' as const
/** Parse-option bridge used by lifecycle-aware Schema checks during tree admission. */
export const TreeValidationPhaseOption =
  '@effect-state-tree/validation-phase' as const
/** Parse-option key distinguishing hard admission from sidecar diagnostics. */
export const TreeValidationModeOption =
  '@effect-state-tree/validation-mode' as const

/** Lifecycle boundary at which the same Effect Schema is being interpreted. */
export type TreeValidationPhase =
  | 'externalDecode'
  | 'construction'
  | 'treeMutation'
  | 'draft'
  | 'persistence'
  | 'replication'

/** Whether lifecycle checks reject a value or collect reportable issues. */
export type TreeValidationMode = 'admission' | 'diagnostic'

/** Creates strict Effect Schema parse options for a tree lifecycle boundary. */
export const treeSchemaParseOptions = (
  phase: TreeValidationPhase,
  mode: TreeValidationMode
): SchemaAST.ParseOptions =>
  ({
    errors: 'all',
    onExcessProperty: 'error',
    [TreeValidationPhaseOption]: phase,
    [TreeValidationModeOption]: mode,
  }) as SchemaAST.ParseOptions

/** Stable entity type and ID-property metadata stored on an Effect Schema. */
export interface EntityAnnotation {
  /** Stable entity namespace. */
  readonly type: string
  /** Property containing the stable string or number ID. */
  readonly id: string
}

declare module 'effect/Schema' {
  namespace Annotations {
    interface Annotations {
      readonly '@effect-state-tree/entity'?: EntityAnnotation | undefined
      readonly '@effect-state-tree/atomic'?: boolean | undefined
      readonly '@effect-state-tree/collaborative-text'?: boolean | undefined
    }
  }
}

/** Canonical decoded snapshot type described by a tree Schema. */
export type TreeValue<S extends Schema.Constraint> = Schema.Schema.Type<S>

interface CompiledAstNode {
  readonly ast: SchemaAST.AST
  readonly properties?: ReadonlyMap<PropertyKey, SchemaAST.AST>
  readonly indexValue?: SchemaAST.AST
}

interface CompiledNavigation {
  readonly nodes: WeakMap<SchemaAST.AST, CompiledAstNode>
}

const CompiledNavigationSymbol: unique symbol = Symbol(
  '@effect-state-tree/core/CompiledNavigation'
)

/**
 * Compiled, reusable interpretation of one Effect Schema as a tree.
 *
 * A spec caches AST navigation and carries custom atomic interpreters. It is a
 * runtime interpreter for `schema`, never a second model declaration.
 */
export interface TreeSpec<S extends Schema.Constraint> {
  /** Original Effect Schema supplied by the application. */
  readonly schema: S
  /** Canonical JSON codec derived once from the source Schema. */
  readonly jsonCodec: Schema.toCodecJson<S>
  /** Type-side Schema used for decoded tree admission. */
  readonly typeSchema: Schema.toType<S>
  /** Root type AST used by compiled tuple-path navigation. */
  readonly typeAst: SchemaAST.AST
  /** Atomic leaf interpreters active for this tree. */
  readonly atomicInterpreters: ReadonlyArray<AtomicInterpreter<unknown>>
  /** Precompiled private navigation data used by path-based operations. */
  readonly [CompiledNavigationSymbol]: CompiledNavigation
}

/** Optional extensions used while compiling a tree Schema. */
export interface TreeSpecOptions {
  /** Additional immutable atomic leaf interpreters. */
  readonly atomicInterpreters?: ReadonlyArray<AtomicInterpreter<unknown>>
}

/** Compiles an Effect Schema into the navigation metadata used by the kernel. */
export const makeTreeSpec = <S extends Schema.Constraint>(
  schema: S,
  options: TreeSpecOptions = {}
): TreeSpec<S> => {
  const typeSchema = Schema.toType(schema)
  return {
    schema,
    jsonCodec: Schema.toCodecJson(schema),
    typeSchema,
    typeAst: typeSchema.ast,
    atomicInterpreters: uniqBy(
      options.atomicInterpreters ?? [],
      (interpreter) => interpreter.name
    ),
    [CompiledNavigationSymbol]: { nodes: new WeakMap() },
  }
}

/** Returns the snapshot capture options carried by a compiled tree spec. */
export const snapshotOptionsFor = (
  spec: TreeSpec<Schema.Constraint>
): SnapshotOptions => ({ atomicInterpreters: spec.atomicInterpreters })

/** Annotates a Schema with stable `(entity type, ID field)` identity. */
export const entity =
  <const EntityType extends string, const IdKey extends string>(options: {
    readonly type: EntityType
    readonly id: IdKey
  }) =>
  <S extends Schema.Top>(schema: S): S['Rebuild'] =>
    schema.annotate({ [EntityAnnotationKey]: options })

/** Marks a Schema value as an indivisible tree leaf. */
export const atomic = <S extends Schema.Top>(schema: S): S['Rebuild'] =>
  schema.annotate({ [AtomicAnnotationKey]: true })

/** Marks a string Schema for native collaborative-text materialization. */
export const collaborativeText = <S extends Schema.Top>(
  schema: S
): S['Rebuild'] => schema.annotate({ [CollaborativeTextAnnotationKey]: true })

const annotationFromCheck = (
  check: SchemaAST.Check<unknown>,
  key: string
): unknown => {
  const direct = check.annotations?.[key]
  if (direct !== undefined) return direct
  if (check._tag === 'FilterGroup') {
    for (let index = check.checks.length - 1; index >= 0; index -= 1) {
      const nested = check.checks[index]
      if (nested === undefined) continue
      const value = annotationFromCheck(nested, key)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/** Reads a tree annotation from an AST or any checks attached to that AST. */
export const resolveTreeAnnotation = <A>(
  ast: SchemaAST.AST,
  key: string
): A | undefined => {
  if (ast.checks !== undefined) {
    for (let index = ast.checks.length - 1; index >= 0; index -= 1) {
      const check = ast.checks[index]
      if (check === undefined) continue
      const value = annotationFromCheck(check, key)
      if (value !== undefined) return value as A
    }
  }
  return ast.annotations?.[key] as A | undefined
}

const literalMatches = (ast: SchemaAST.Literal, value: unknown): boolean =>
  Object.is(ast.literal, value)

const shallowMatches = (ast: SchemaAST.AST, value: unknown): boolean => {
  switch (ast._tag) {
    case 'Null':
      return value === null
    case 'Undefined':
    case 'Void':
      return value === undefined
    case 'String':
    case 'TemplateLiteral':
      return typeof value === 'string'
    case 'Number':
      return typeof value === 'number'
    case 'Boolean':
      return typeof value === 'boolean'
    case 'BigInt':
      return typeof value === 'bigint'
    case 'Symbol':
    case 'UniqueSymbol':
      return typeof value === 'symbol'
    case 'Literal':
      return literalMatches(ast, value)
    case 'Arrays':
      return Array.isArray(value)
    case 'Objects':
      return isPlainObject(value)
    case 'Union':
      return ast.types.some((member) => shallowMatches(member, value))
    case 'Suspend':
      return shallowMatches(ast.thunk(), value)
    case 'Never':
      return false
    default:
      return true
  }
}

const unwrapSuspend = (ast: SchemaAST.AST): SchemaAST.AST => {
  let current = ast
  while (SchemaAST.isSuspend(current)) current = current.thunk()
  return current
}

/**
 * Selects a union member only when shallow structure or literal discriminants
 * identify exactly one candidate. Overlapping unions remain opaque so a path
 * can never silently inherit the codec or identity metadata of the first arm.
 */
export const selectUnionMember = (
  ast: SchemaAST.Union,
  value: unknown
): SchemaAST.AST | undefined => {
  const structuralMatches = ast.types.filter((member) =>
    shallowMatches(member, value)
  )
  if (structuralMatches.length <= 1) return structuralMatches[0]

  if (!isPlainObject(value)) return undefined

  const discriminated = structuralMatches.filter((member) => {
    const candidate = unwrapSuspend(member)
    if (!SchemaAST.isObjects(candidate)) return false
    const literals = candidate.propertySignatures.filter((property) =>
      SchemaAST.isLiteral(property.type)
    )
    return (
      literals.length > 0 &&
      literals.every(
        (property) =>
          typeof property.name !== 'symbol' &&
          literalMatches(
            property.type as SchemaAST.Literal,
            value[property.name]
          )
      )
    )
  })

  return discriminated.length === 1 ? discriminated[0] : undefined
}

/** Selects the concrete AST represented by a decoded runtime value. */
export const normalizeAstForValue = (
  ast: SchemaAST.AST,
  value: unknown
): SchemaAST.AST => {
  const chain = schemaAstChainForValue(ast, value)
  return chain.at(-1) ?? ast
}

/** Schema, value, and annotation context observed during a tree walk. */
export interface SchemaWalkEntry {
  /** The selected concrete AST used for tree traversal. */
  readonly ast: SchemaAST.AST
  /** Wrapper-to-concrete AST chain, retaining checks on Union and Suspend nodes. */
  readonly asts: ReadonlyArray<SchemaAST.AST>
  /** Decoded value represented by the selected AST. */
  readonly value: unknown
  /** Tuple path of the decoded value. */
  readonly path: TreePath
}

/** Retains the wrapper-to-concrete AST chain selected for a runtime value. */
export const schemaAstChainForValue = (
  ast: SchemaAST.AST,
  value: unknown
): ReadonlyArray<SchemaAST.AST> => {
  const chain: Array<SchemaAST.AST> = []
  let current = ast
  while (true) {
    chain.push(current)
    if (SchemaAST.isSuspend(current)) {
      current = current.thunk()
      continue
    }
    if (SchemaAST.isUnion(current)) {
      const member = selectUnionMember(current, value)
      if (member !== undefined) {
        current = member
        continue
      }
    }
    return chain
  }
}

/** Resolves the nearest tree annotation from a wrapper-to-concrete AST chain. */
export const resolveTreeAnnotationFromAsts = <A>(
  asts: ReadonlyArray<SchemaAST.AST>,
  key: string
): A | undefined => {
  for (let index = asts.length - 1; index >= 0; index -= 1) {
    const ast = asts[index]
    if (ast === undefined) continue
    const annotation = resolveTreeAnnotation<A>(ast, key)
    if (annotation !== undefined) return annotation
  }
  return undefined
}

const compiledNode = (
  spec: TreeSpec<Schema.Constraint>,
  ast: SchemaAST.AST
): CompiledAstNode => {
  const compiled = spec[CompiledNavigationSymbol]
  const cached = compiled.nodes.get(ast)
  if (cached !== undefined) return cached

  const indexValue = SchemaAST.isObjects(ast)
    ? ast.indexSignatures[0]?.type
    : undefined
  const node: CompiledAstNode = SchemaAST.isObjects(ast)
    ? {
        ast,
        properties: new Map(
          ast.propertySignatures.map((property) => [
            property.name,
            property.type,
          ])
        ),
        ...(indexValue === undefined ? {} : { indexValue }),
      }
    : { ast }
  compiled.nodes.set(ast, node)
  return node
}

const arrayChildAst = (
  ast: SchemaAST.Arrays,
  index: number,
  length: number
): SchemaAST.AST | undefined => {
  if (!Number.isSafeInteger(index) || index < 0) return undefined
  if (index < ast.elements.length) return ast.elements[index]
  if (ast.rest.length === 0) return undefined
  if (ast.rest.length === 1) return ast.rest[0]
  const trailing = ast.rest.length - 1
  const trailingStart = Math.max(ast.elements.length, length - trailing)
  if (index >= trailingStart) return ast.rest[index - trailingStart + 1]
  return ast.rest[0]
}

const objectChildAst = (
  spec: TreeSpec<Schema.Constraint>,
  ast: SchemaAST.Objects,
  key: string
): SchemaAST.AST | undefined => {
  const node = compiledNode(spec, ast)
  return node.properties?.get(key) ?? node.indexValue
}

export interface SchemaNavigationError {
  readonly _tag: 'SchemaNavigationError'
  readonly path: TreePath
  readonly segmentIndex: number
  readonly reason:
    | 'missing-path'
    | 'invalid-path-segment'
    | 'unsupported-structural-transformation'
    | 'atomic-descent'
    | 'ambiguous-union-descent'
  readonly astTag: string
}

export interface ResolvedSchemaPath {
  readonly ast: SchemaAST.AST
  readonly asts: ReadonlyArray<SchemaAST.AST>
  readonly value: unknown
}

const navigationFailure = (
  path: TreePath,
  segmentIndex: number,
  reason: SchemaNavigationError['reason'],
  ast: SchemaAST.AST
): Result.Result<never, SchemaNavigationError> =>
  Result.fail({
    _tag: 'SchemaNavigationError',
    path: [...path],
    segmentIndex,
    reason,
    astTag: ast._tag,
  })

/**
 * Resolves type or codec ASTs through the decoded tree using the TreeSpec's
 * compiled property maps. Atomic, transformed, and ambiguous-union containers
 * are explicit boundaries rather than best-effort traversal points.
 */
export const resolveSchemaPath = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath,
  source: 'type' | 'codec' = 'type'
): Result.Result<ResolvedSchemaPath, SchemaNavigationError> => {
  let ast = source === 'type' ? spec.typeAst : spec.schema.ast
  let value = root

  for (let segmentIndex = 0; segmentIndex < path.length; segmentIndex += 1) {
    const segment = path[segmentIndex]
    const asts = schemaAstChainForValue(ast, value)
    const concrete = asts.at(-1) ?? ast

    if (
      resolveTreeAnnotationFromAsts<boolean>(asts, AtomicAnnotationKey) === true
    ) {
      return navigationFailure(path, segmentIndex, 'atomic-descent', concrete)
    }
    if (SchemaAST.isUnion(concrete)) {
      return navigationFailure(
        path,
        segmentIndex,
        'ambiguous-union-descent',
        concrete
      )
    }
    if (
      source === 'codec' &&
      asts.some((candidate) => candidate.encoding !== undefined)
    ) {
      const transformed = asts.find(
        (candidate) => candidate.encoding !== undefined
      )
      return navigationFailure(
        path,
        segmentIndex,
        'unsupported-structural-transformation',
        transformed ?? concrete
      )
    }

    if (SchemaAST.isArrays(concrete)) {
      if (!Array.isArray(value) || typeof segment !== 'number') {
        return navigationFailure(
          path,
          segmentIndex,
          'invalid-path-segment',
          concrete
        )
      }
      const child = arrayChildAst(concrete, segment, value.length)
      if (child === undefined) {
        return navigationFailure(path, segmentIndex, 'missing-path', concrete)
      }
      ast = child
      value = value[segment]
      continue
    }

    if (SchemaAST.isObjects(concrete)) {
      if (!isPlainObject(value) || typeof segment !== 'string') {
        return navigationFailure(
          path,
          segmentIndex,
          'invalid-path-segment',
          concrete
        )
      }
      const child = objectChildAst(spec, concrete, segment)
      if (child === undefined) {
        return navigationFailure(path, segmentIndex, 'missing-path', concrete)
      }
      ast = child
      value = value[segment]
      continue
    }

    return navigationFailure(path, segmentIndex, 'missing-path', concrete)
  }

  const asts = schemaAstChainForValue(ast, value)
  return Result.succeed({ ast, asts, value })
}

/** Walks a decoded value and its selected Schema AST in path order. */
export const walkSchemaValue = (
  spec: TreeSpec<Schema.Constraint>,
  value: unknown,
  visit: (entry: SchemaWalkEntry) => void
): void => {
  const walk = (ast: SchemaAST.AST, node: unknown, path: TreePath): void => {
    const asts = schemaAstChainForValue(ast, node)
    const normalized = asts.at(-1) ?? ast
    visit({ ast: normalized, asts, value: node, path })

    if (
      SchemaAST.isUnion(normalized) ||
      resolveTreeAnnotationFromAsts<boolean>(asts, AtomicAnnotationKey) === true
    )
      return

    if (SchemaAST.isArrays(normalized) && Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const child = arrayChildAst(normalized, index, node.length)
        if (child !== undefined) walk(child, node[index], [...path, index])
      }
      return
    }

    if (SchemaAST.isObjects(normalized) && isPlainObject(node)) {
      for (const key of Object.keys(node)) {
        const child = objectChildAst(spec, normalized, key)
        if (child !== undefined) walk(child, node[key], [...path, key])
      }
    }
  }

  walk(spec.typeAst, value, [])
}

/** Resolves the selected type AST at a decoded tuple path. */
export const schemaAstAt = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): SchemaAST.AST | undefined => {
  const resolved = resolveSchemaPath(spec, root, path)
  return Result.isSuccess(resolved)
    ? (resolved.success.asts.at(-1) ?? resolved.success.ast)
    : undefined
}

/** Resolves the complete type-AST wrapper chain at a decoded tuple path. */
export const schemaAstsAt = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): ReadonlyArray<SchemaAST.AST> | undefined => {
  const resolved = resolveSchemaPath(spec, root, path)
  return Result.isSuccess(resolved) ? resolved.success.asts : undefined
}

/** Resolves the original codec AST chain, retaining Effect Schema encodings. */
export const schemaCodecAstsAt = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): ReadonlyArray<SchemaAST.AST> | undefined => {
  const resolved = resolveSchemaPath(spec, root, path, 'codec')
  return Result.isSuccess(resolved) ? resolved.success.asts : undefined
}

/** Reads a tree annotation at a decoded tuple path. */
export const treeAnnotationAt = <A>(
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath,
  key: string
): A | undefined => {
  const asts = schemaAstsAt(spec, root, path)
  return asts === undefined
    ? undefined
    : resolveTreeAnnotationFromAsts<A>(asts, key)
}

/** Reads stable entity metadata at a decoded tuple path. */
export const entityAnnotationAt = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): EntityAnnotation | undefined =>
  treeAnnotationAt<EntityAnnotation>(spec, root, path, EntityAnnotationKey)

/** Returns the validated entity identity present at a decoded tuple path. */
export const identityAt = (
  spec: TreeSpec<Schema.Constraint>,
  root: unknown,
  path: TreePath
): EntityIdentity | undefined => {
  const annotation = entityAnnotationAt(spec, root, path)
  if (annotation === undefined) return undefined

  const resolved = getAtPath(root, path)
  if (Result.isFailure(resolved) || !isPlainObject(resolved.success)) {
    return undefined
  }
  const id = resolved.success[annotation.id]
  return typeof id === 'string' || typeof id === 'number'
    ? { entityType: annotation.type, id }
    : undefined
}
