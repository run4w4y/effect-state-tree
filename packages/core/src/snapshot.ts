import { Result } from 'effect'
import { isPlainObject as isPlainObjectValue } from 'es-toolkit/predicate'

import type { AliasedNodeError, UnsupportedTreeNodeError } from './errors'
import type { TreePath } from './path'

/** Failures that prevent a value from becoming an immutable tree snapshot. */
export type SnapshotError = AliasedNodeError | UnsupportedTreeNodeError

/**
 * Captures an application-defined atomic value as an immutable snapshot leaf.
 *
 * The interpreter owns the immutability strategy because `Object.freeze` does
 * not make mutable built-ins such as `Map` safe. `isSnapshot` is checked after
 * every capture and whenever an existing snapshot is admitted again.
 */
export interface AtomicInterpreter<A> {
  /** Human-readable interpreter name used in diagnostics. */
  readonly name: string
  /** Detects values owned by this interpreter. */
  is(value: unknown): value is A
  /** Captures a mutable input as an immutable atomic snapshot. */
  capture(value: A): A
  /** Verifies that a value is already a valid immutable snapshot. */
  isSnapshot(value: A): boolean
  /** Optional equality used during diffing and reconciliation. */
  equals?(left: A, right: A): boolean
}

/** Atomic leaf interpreters available while capturing a snapshot. */
export interface SnapshotOptions {
  /** Additional immutable atomic leaf interpreters. */
  readonly atomicInterpreters?: ReadonlyArray<AtomicInterpreter<unknown>>
}

/** Tests whether a value is a structurally traversable plain object. */
export const isPlainObject = (
  value: unknown
): value is Record<string, unknown> => isPlainObjectValue(value)

/** Tests whether a value is a traversable tree array or plain object. */
export const isTreeContainer = (
  value: unknown
): value is ReadonlyArray<unknown> | Record<string, unknown> =>
  Array.isArray(value) || isPlainObject(value)

const dateMutators = new Set<PropertyKey>([
  'setDate',
  'setFullYear',
  'setHours',
  'setMilliseconds',
  'setMinutes',
  'setMonth',
  'setSeconds',
  'setTime',
  'setUTCDate',
  'setUTCFullYear',
  'setUTCHours',
  'setUTCMilliseconds',
  'setUTCMinutes',
  'setUTCMonth',
  'setUTCSeconds',
  'setYear',
])

const immutableDates = new WeakSet<object>()

const immutableDate = (value: Date): Date => {
  const target = Object.freeze(new Date(value.getTime()))
  const methods = new Map<PropertyKey, unknown>()
  const proxy = new Proxy(target, {
    defineProperty: () => false,
    deleteProperty: () => false,
    get(date, property) {
      if (property === Symbol.toStringTag) return 'Date'
      if (property === 'constructor') return Date

      const cached = methods.get(property)
      if (cached !== undefined) return cached

      if (dateMutators.has(property)) {
        const rejectMutation = () => {
          throw new TypeError('effect-state-tree Date snapshots are immutable')
        }
        methods.set(property, rejectMutation)
        return rejectMutation
      }
      const member = Reflect.get(date, property, date)
      if (typeof member !== 'function') return member

      const bound = member.bind(date)
      methods.set(property, bound)
      return bound
    },
    set: () => false,
    setPrototypeOf: () => false,
  })
  immutableDates.add(proxy)
  return proxy
}

/**
 * Opt-in compatibility interpreter for mutable native `Date` values.
 *
 * The captured value is a Date-like proxy and therefore cannot be structured
 * cloned. Prefer an immutable time representation for canonical application
 * state when that limitation matters.
 */
export const dateAtomicInterpreter: AtomicInterpreter<Date> = {
  name: 'Date',
  is: (value): value is Date => value instanceof Date,
  capture: immutableDate,
  isSnapshot: (value) => immutableDates.has(value),
  equals: (left, right) => Object.is(left.getTime(), right.getTime()),
}

const allInterpreters = (
  options: SnapshotOptions
): ReadonlyArray<AtomicInterpreter<unknown>> => options.atomicInterpreters ?? []

const findInterpreter = (
  value: unknown,
  options: SnapshotOptions
): AtomicInterpreter<unknown> | undefined =>
  allInterpreters(options).find((interpreter) => interpreter.is(value))

const copyPath = (path: ReadonlyArray<string | number>): TreePath => [...path]

const mutableAtomicError = (path: TreePath): UnsupportedTreeNodeError => ({
  _tag: 'UnsupportedTreeNodeError',
  path,
  reason: 'mutable-atomic',
})

const findSnapshotError = (
  value: unknown,
  options: SnapshotOptions,
  allowUncapturedAtomics = false,
  requireFrozenContainers = true
): SnapshotError | undefined => {
  const seen = new WeakMap<object, TreePath>()

  const visit = (
    node: unknown,
    path: Array<string | number>
  ): SnapshotError | undefined => {
    const interpreter = findInterpreter(node, options)
    if (interpreter !== undefined) {
      return allowUncapturedAtomics || interpreter.isSnapshot(node)
        ? undefined
        : mutableAtomicError(copyPath(path))
    }

    if (!isTreeContainer(node)) {
      return node !== null && typeof node === 'object'
        ? mutableAtomicError(copyPath(path))
        : undefined
    }

    if (requireFrozenContainers && !Object.isFrozen(node)) {
      return {
        _tag: 'UnsupportedTreeNodeError',
        path: copyPath(path),
        reason: 'mutable-container',
      }
    }

    const previous = seen.get(node)
    if (previous !== undefined) {
      return {
        _tag: 'AliasedNodeError',
        firstPath: previous,
        secondPath: copyPath(path),
      }
    }
    seen.set(node, copyPath(path))

    if (!Array.isArray(node)) {
      const hasEnumerableSymbol = Object.getOwnPropertySymbols(node).some(
        (key) => Object.prototype.propertyIsEnumerable.call(node, key)
      )
      if (hasEnumerableSymbol) {
        return {
          _tag: 'UnsupportedTreeNodeError',
          path: copyPath(path),
          reason: 'symbol-key',
        }
      }
    }

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const error = visit(node[index], [...path, index])
        if (error !== undefined) return error
      }
      return undefined
    }

    if (!isPlainObject(node)) return undefined
    for (const key of Object.keys(node)) {
      const error = visit(node[key], [...path, key])
      if (error !== undefined) return error
    }
    return undefined
  }

  return visit(value, [])
}

/** Validates one-parent ownership and atomic-leaf immutability without copying. */
export const validateSnapshotShape = (
  value: unknown,
  options: SnapshotOptions = {}
): Result.Result<void, SnapshotError> => {
  const error = findSnapshotError(value, options)
  return error === undefined ? Result.void : Result.fail(error)
}

const cloneAndFreeze = <A>(
  value: A,
  options: SnapshotOptions,
  path: TreePath = []
): Result.Result<A, SnapshotError> => {
  const interpreter = findInterpreter(value, options)
  if (interpreter !== undefined) {
    if (interpreter.isSnapshot(value)) return Result.succeed(value)

    const captured = Result.try({
      try: () => interpreter.capture(value),
      catch: () => mutableAtomicError(path),
    })
    if (Result.isFailure(captured)) return Result.fail(captured.failure)
    return interpreter.isSnapshot(captured.success)
      ? Result.succeed(captured.success as A)
      : Result.fail(mutableAtomicError(path))
  }

  if (Array.isArray(value)) {
    const output: Array<unknown> = []
    for (let index = 0; index < value.length; index += 1) {
      const child = cloneAndFreeze(value[index], options, [...path, index])
      if (Result.isFailure(child)) return Result.fail(child.failure)
      output.push(child.success)
    }
    return Result.succeed(Object.freeze(output) as A)
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(value)
    )
    for (const key of Object.keys(value)) {
      const child = cloneAndFreeze(value[key], options, [...path, key])
      if (Result.isFailure(child)) return Result.fail(child.failure)
      output[key] = child.success
    }
    return Result.succeed(Object.freeze(output) as A)
  }

  return Result.succeed(value)
}

/**
 * Compares values handled by registered atomic interpreters.
 *
 * `undefined` means neither value forms a comparable atomic pair. This is an
 * internal kernel primitive shared by snapshot diffing and reconciliation.
 */
export const atomicSnapshotEquality = (
  left: unknown,
  right: unknown,
  options: SnapshotOptions = {}
): boolean | undefined => {
  const leftInterpreter = findInterpreter(left, options)
  const rightInterpreter = findInterpreter(right, options)
  if (leftInterpreter === undefined && rightInterpreter === undefined) {
    return undefined
  }
  if (
    leftInterpreter === undefined ||
    rightInterpreter === undefined ||
    leftInterpreter !== rightInterpreter
  ) {
    return false
  }
  return leftInterpreter.equals?.(left, right) ?? Object.is(left, right)
}

/** Deeply captures, de-aliases, and freezes a value as a canonical snapshot. */
export const captureSnapshot = <A>(
  value: A,
  options: SnapshotOptions = {}
): Result.Result<A, SnapshotError> => {
  const admitted = validateSnapshotShape(value, options)
  if (Result.isSuccess(admitted)) return Result.succeed(value)

  const error = findSnapshotError(value, options, true, false)
  return error === undefined
    ? cloneAndFreeze(value, options)
    : Result.fail(error)
}

/** Freezes a newly copied array or plain object while retaining its type. */
export const freezeChangedContainer = <A>(value: A): A => {
  if (isTreeContainer(value) && !Object.isFrozen(value)) Object.freeze(value)
  return value
}

/** Compares canonical snapshots, including interpreter-defined atomic equality. */
export const deepEqualSnapshot = (
  left: unknown,
  right: unknown,
  options: SnapshotOptions = {}
): boolean => {
  if (Object.is(left, right)) return true

  const atomicEquality = atomicSnapshotEquality(left, right, options)
  if (atomicEquality !== undefined) return atomicEquality

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqualSnapshot(left[index], right[index], options)) return false
    }
    return true
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) return false
      if (!deepEqualSnapshot(left[key], right[key], options)) return false
    }
    return true
  }
  return false
}
