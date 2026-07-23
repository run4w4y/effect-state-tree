import { Result } from 'effect'

/** A property name or array index in a tree path. */
export type TreePathSegment = string | number

/**
 * A path from a tree root to one of its descendants.
 *
 * Numeric segments are reserved for array indexes. Object keys, including
 * numeric-looking keys such as `"0"`, are represented as strings.
 */
export type TreePath = readonly TreePathSegment[]

/** Resolves the value addressed by a tuple path at the type level. */
export type TreePathValue<
  Value,
  Path extends TreePath,
> = Path extends readonly []
  ? Value
  : Path extends readonly [infer Head, ...infer Tail]
    ? Head extends keyof Value
      ? TreePathValue<Value[Head], Extract<Tail, TreePath>>
      : Head extends number
        ? Value extends ReadonlyArray<infer Item>
          ? TreePathValue<Item, Extract<Tail, TreePath>>
          : never
        : never
    : never

/** Reasons an RFC 6901 JSON Pointer cannot be decoded. */
export type JsonPointerDecodeFailureReason = 'InvalidPointer' | 'InvalidEscape'

/** Structured, non-throwing JSON Pointer decoding failure. */
export interface JsonPointerDecodeError {
  /** Discriminant for JSON Pointer decoding failure. */
  readonly _tag: 'JsonPointerDecodeError'
  /** Original pointer supplied to the decoder. */
  readonly pointer: string
  /** Pointer grammar rule that failed. */
  readonly reason: JsonPointerDecodeFailureReason
  /** Character offset in the original pointer at which decoding failed. */
  readonly at: number
  /** Human-readable decoding failure. */
  readonly message: string
}

/** Result of decoding an RFC 6901 pointer into a tuple path. */
export type JsonPointerDecodeResult = Result.Result<
  TreePath,
  JsonPointerDecodeError
>

/** Controls how numeric-looking JSON Pointer tokens become path segments. */
export interface JsonPointerDecodeOptions {
  /**
   * How decoded JSON Pointer tokens should represent array indexes.
   *
   * `"canonical"` converts canonical, non-negative safe integers (`0`, `1`,
   * `42`) to numbers. Tokens with leading zeroes, negative numbers, and unsafe
   * integers remain strings. This is the default and is appropriate for the
   * library's tuple paths.
   *
   * JSON Pointer does not encode whether a token is an object key or an array
   * index. Use `"strings"` when numeric-looking object keys must be preserved.
   */
  readonly numberSegments?: 'canonical' | 'strings'
}

const canonicalArrayIndexPattern = /^(?:0|[1-9][0-9]*)$/

const escapeJsonPointerToken = (token: string): string =>
  token.replace(/~/g, '~0').replace(/\//g, '~1')

/** Encodes a tuple path as an RFC 6901 JSON Pointer. */
export const pathToJsonPointer = (path: TreePath): string => {
  if (path.length === 0) {
    return ''
  }

  return `/${path.map((segment) => escapeJsonPointerToken(String(segment))).join('/')}`
}

const decodeJsonPointerToken = (
  pointer: string,
  token: string,
  tokenOffset: number
): Result.Result<string, JsonPointerDecodeError> => {
  let decoded = ''

  for (let index = 0; index < token.length; index++) {
    const character = token.charAt(index)

    if (character !== '~') {
      decoded += character
      continue
    }

    const escapeCode = token.charAt(index + 1)
    if (escapeCode === '0') {
      decoded += '~'
    } else if (escapeCode === '1') {
      decoded += '/'
    } else {
      return Result.fail({
        _tag: 'JsonPointerDecodeError',
        pointer,
        reason: 'InvalidEscape',
        at: tokenOffset + index,
        message: "A JSON Pointer '~' escape must be followed by '0' or '1'",
      })
    }

    index++
  }

  return Result.succeed(decoded)
}

const tokenToPathSegment = (
  token: string,
  numberSegments: 'canonical' | 'strings'
): TreePathSegment => {
  if (numberSegments === 'strings' || !canonicalArrayIndexPattern.test(token)) {
    return token
  }

  const index = Number(token)
  return Number.isSafeInteger(index) ? index : token
}

/**
 * Decodes an RFC 6901 JSON Pointer without throwing.
 *
 * Percent escapes are intentionally not decoded; URI-fragment decoding is a
 * separate operation from JSON Pointer decoding.
 */
export const jsonPointerToPath = (
  pointer: string,
  options: JsonPointerDecodeOptions = {}
): JsonPointerDecodeResult => {
  if (pointer === '') {
    return Result.succeed([])
  }

  if (!pointer.startsWith('/')) {
    return Result.fail({
      _tag: 'JsonPointerDecodeError',
      pointer,
      reason: 'InvalidPointer',
      at: 0,
      message: "A JSON Pointer must be empty or begin with '/'",
    })
  }

  const numberSegments = options.numberSegments ?? 'canonical'
  const encodedTokens = pointer.slice(1).split('/')
  const path: TreePathSegment[] = []
  let tokenOffset = 1

  for (const encodedToken of encodedTokens) {
    const decoded = decodeJsonPointerToken(pointer, encodedToken, tokenOffset)
    if (Result.isFailure(decoded)) {
      return Result.fail(decoded.failure)
    }

    path.push(tokenToPathSegment(decoded.success, numberSegments))
    tokenOffset += encodedToken.length + 1
  }

  return Result.succeed(path)
}

/** Reasons safe tuple-path traversal can fail. */
export type GetAtPathFailureReason =
  | 'InvalidArrayIndex'
  | 'ExpectedArray'
  | 'NotTraversable'
  | 'MissingSegment'
  | 'AccessError'

interface GetAtPathFailureBase {
  readonly _tag: 'GetAtPathFailure'
  readonly reason: GetAtPathFailureReason
  readonly path: TreePath
  /** Index of the segment that could not be followed. */
  readonly at: number
  readonly segment: TreePathSegment
  readonly traversed: TreePath
}

/** Structured failure returned by safe tuple-path traversal. */
export type GetAtPathFailure =
  | (GetAtPathFailureBase & {
      readonly reason:
        | 'InvalidArrayIndex'
        | 'ExpectedArray'
        | 'NotTraversable'
        | 'MissingSegment'
    })
  | (GetAtPathFailureBase & {
      readonly reason: 'AccessError'
      readonly cause: unknown
    })

/** Result of resolving an unknown value at a tuple path without throwing. */
export type GetAtPathResult = Result.Result<unknown, GetAtPathFailure>

const isTraversable = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

const pathFailure = (
  reason: Exclude<GetAtPathFailureReason, 'AccessError'>,
  path: TreePath,
  at: number,
  segment: TreePathSegment
): GetAtPathFailure => ({
  _tag: 'GetAtPathFailure',
  reason,
  path,
  at,
  segment,
  traversed: path.slice(0, at),
})

/**
 * Safely resolves a tuple path using own properties only.
 *
 * Numeric segments only address arrays and must be non-negative safe integer
 * indexes. Accessor and Proxy failures are represented as `AccessError` rather
 * than escaping as exceptions.
 */
export const getAtPath = (root: unknown, path: TreePath): GetAtPathResult => {
  let current = root

  for (const [at, segment] of path.entries()) {
    if (
      typeof segment === 'number' &&
      (!Number.isSafeInteger(segment) || segment < 0)
    ) {
      return Result.fail(pathFailure('InvalidArrayIndex', path, at, segment))
    }

    if (!isTraversable(current)) {
      return Result.fail(pathFailure('NotTraversable', path, at, segment))
    }

    try {
      if (typeof segment === 'number' && !Array.isArray(current)) {
        return Result.fail(pathFailure('ExpectedArray', path, at, segment))
      }

      if (!Object.hasOwn(current, segment)) {
        return Result.fail(pathFailure('MissingSegment', path, at, segment))
      }

      current = Reflect.get(current, segment)
    } catch (cause) {
      return Result.fail({
        _tag: 'GetAtPathFailure',
        reason: 'AccessError',
        path,
        at,
        segment,
        traversed: path.slice(0, at),
        cause,
      })
    }
  }

  return Result.succeed(current)
}

/** Returns whether `prefix` is a prefix of `path`, including equality. */
export const isPathPrefix = (prefix: TreePath, path: TreePath): boolean => {
  if (prefix.length > path.length) {
    return false
  }

  for (let index = 0; index < prefix.length; index++) {
    if (prefix[index] !== path[index]) {
      return false
    }
  }

  return true
}

/**
 * Returns whether changes at either path can affect the other path.
 *
 * Two paths overlap when either one is a prefix of the other. Sibling paths do
 * not overlap.
 */
export const pathsOverlap = (left: TreePath, right: TreePath): boolean =>
  isPathPrefix(left, right) || isPathPrefix(right, left)

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Formats a path in a compact JavaScript-like form suitable for diagnostics. */
export const formatTreePath = (path: TreePath): string => {
  let formatted = '$'

  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${String(segment)}]`
    } else if (identifierPattern.test(segment)) {
      formatted += `.${segment}`
    } else {
      formatted += `[${JSON.stringify(segment)}]`
    }
  }

  return formatted
}
