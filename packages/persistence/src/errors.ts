import { Data, type Schema } from 'effect'

/**
 * Persisted JSON could not be decoded as the versioned persistence envelope.
 * The stored value is left untouched so callers may inspect or recover it.
 */
export class PersistenceEnvelopeDecodeError extends Data.TaggedError(
  'PersistenceEnvelopeDecodeError'
)<{
  readonly cause: Schema.SchemaError
}> {}

/** The envelope payload could not be decoded by the tree's canonical Schema. */
export class PersistenceDecodeError extends Data.TaggedError(
  'PersistenceDecodeError'
)<{
  readonly cause: Schema.SchemaError
  readonly version: number
}> {}

/** The decoded tree snapshot could not be encoded for durable storage. */
export class PersistenceEncodeError extends Data.TaggedError(
  'PersistenceEncodeError'
)<{
  readonly cause: Schema.SchemaError
  readonly revision: number
}> {}

/** JSON text loaded from a key-value backend was malformed. */
export class PersistenceJsonParseError extends Data.TaggedError(
  'PersistenceJsonParseError'
)<{
  readonly key: string
  readonly text: string
  readonly cause: unknown
}> {}

/** A versioned persistence envelope could not be represented as JSON. */
export class PersistenceJsonStringifyError extends Data.TaggedError(
  'PersistenceJsonStringifyError'
)<{
  readonly key: string
  readonly value: unknown
  readonly cause: unknown
}> {}

/** A stored payload did not satisfy the Schema declared by its migration. */
export class PersistenceMigrationDecodeError extends Data.TaggedError(
  'PersistenceMigrationDecodeError'
)<{
  readonly cause: Schema.SchemaError
  readonly from: number
  readonly to: number
}> {}

/** No unambiguous migration chain reaches the configured persistence version. */
export class PersistenceMigrationPathError extends Data.TaggedError(
  'PersistenceMigrationPathError'
)<{
  readonly from: number
  readonly target: number
  readonly reason: 'missing' | 'ambiguous' | 'invalid'
}> {}

/** The stored version is newer than the version understood by this client. */
export class PersistenceVersionError extends Data.TaggedError(
  'PersistenceVersionError'
)<{
  readonly stored: number
  readonly supported: number
}> {}

/**
 * An operation requiring the writer was attempted after an explicit abort.
 * Gracefully closed bindings continue to return their final flush result.
 */
export class PersistenceBindingClosedError extends Data.TaggedError(
  'PersistenceBindingClosedError'
)<{
  readonly reason: 'aborted'
}> {}
