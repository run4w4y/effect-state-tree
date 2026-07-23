import { Result, Schema, SchemaParser } from 'effect'

import type {
  DuplicateEntityError,
  EntityNotFoundError,
  InvalidEntityError,
  SchemaAdmissionError,
} from './errors'
import { buildEntityIndex, entityKey } from './identity'
import { type GetAtPathFailure, getAtPath } from './path'
import {
  entity,
  type TreeSpec,
  type TreeValue,
  treeSchemaParseOptions,
} from './spec'

type EntityIdKey<S extends Schema.Top> = {
  [K in keyof Schema.Schema.Type<S> & string]-?: Exclude<
    Schema.Schema.Type<S>[K],
    undefined
  > extends string | number
    ? K
    : never
}[keyof Schema.Schema.Type<S> & string]

type EntityId<S extends Schema.Top, IdKey extends string> = Extract<
  Schema.Schema.Type<S>[IdKey & keyof Schema.Schema.Type<S>],
  string | number
>

/**
 * Couples entity identity metadata to the Schema that defines the resolved
 * value. Tree references can therefore derive both their ID and result types;
 * callers never supply an unrelated phantom type argument.
 */
export interface EntityDescriptor<
  S extends Schema.Top,
  EntityType extends string,
  IdKey extends string,
> {
  /** Effect Schema defining the referenced entity value. */
  readonly schema: S
  /** Stable entity namespace stored in Schema annotations. */
  readonly entityType: EntityType
  /** Property containing the entity's stable ID. */
  readonly idKey: IdKey
}

/** Defines and annotates an entity Schema in one operation. */
export const defineEntity = <
  S extends Schema.Top,
  const EntityType extends string,
  const IdKey extends EntityIdKey<S>,
>(
  schema: S,
  options: { readonly type: EntityType; readonly id: IdKey }
): EntityDescriptor<S['Rebuild'], EntityType, IdKey> => ({
  schema: schema.pipe(entity(options)),
  entityType: options.type,
  idKey: options.id,
})

const TreeRefTypeId: unique symbol = Symbol('@effect-state-tree/core/TreeRef')

/** Serializable, Schema-typed reference to an entity in a tree root. */
export interface TreeRef<
  S extends Schema.Top,
  EntityType extends string,
  IdKey extends string,
> {
  /** Stable entity namespace to resolve. */
  readonly entityType: EntityType
  /** Stable entity ID to resolve. */
  readonly id: EntityId<S, IdKey>
  /** Private descriptor brand preserving the referenced entity type. */
  readonly [TreeRefTypeId]: EntityDescriptor<S, EntityType, IdKey>
}

/** Creates a typed entity reference from its defining descriptor and ID. */
export const makeTreeRef = <
  S extends Schema.Top,
  const EntityType extends string,
  const IdKey extends string,
>(
  descriptor: EntityDescriptor<S, EntityType, IdKey>,
  id: EntityId<S, IdKey>
): TreeRef<S, EntityType, IdKey> => ({
  entityType: descriptor.entityType,
  id,
  [TreeRefTypeId]: descriptor,
})

/** Failures possible while indexing, locating, and validating a tree ref. */
export type ResolveTreeRefError =
  | DuplicateEntityError
  | InvalidEntityError
  | EntityNotFoundError
  | GetAtPathFailure
  | SchemaAdmissionError

/** Resolves a typed entity reference while preserving canonical object identity. */
export const resolveTreeRef = <
  Root extends Schema.Constraint,
  EntitySchema extends Schema.Top,
  EntityType extends string,
  IdKey extends string,
>(
  spec: TreeSpec<Root>,
  snapshot: TreeValue<Root>,
  reference: TreeRef<EntitySchema, EntityType, IdKey>
): Result.Result<EntitySchema['Type'], ResolveTreeRefError> =>
  Result.gen(function* () {
    const index = yield* buildEntityIndex(spec, snapshot)
    const entry = index.get(entityKey(reference))
    if (entry === undefined) {
      return yield* Result.fail({
        _tag: 'EntityNotFoundError' as const,
        entityType: reference.entityType,
        id: reference.id,
      })
    }

    const value = yield* getAtPath(snapshot, entry.path)
    const descriptor = reference[TreeRefTypeId]
    const decoded = SchemaParser.decodeUnknownResult(
      Schema.toType(descriptor.schema),
      treeSchemaParseOptions('treeMutation', 'admission')
    )(value)
    if (Result.isFailure(decoded)) {
      return yield* Result.fail({
        _tag: 'SchemaAdmissionError' as const,
        issue: decoded.failure,
      })
    }
    // Decoding proves the indexed node's type, but may allocate a fresh Struct.
    // References must preserve the canonical snapshot identity they resolved.
    return value as EntitySchema['Type']
  })
