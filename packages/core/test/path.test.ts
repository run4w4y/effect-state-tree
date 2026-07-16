import { describe, expect, it } from 'bun:test'
import { Result } from 'effect'
import {
  formatTreePath,
  getAtPath,
  isPathPrefix,
  jsonPointerToPath,
  pathsOverlap,
  pathToJsonPointer,
} from '../src/index'

describe('JSON Pointer conversion', () => {
  it('encodes the root and escapes RFC 6901 tokens', () => {
    expect(pathToJsonPointer([])).toBe('')
    expect(pathToJsonPointer(['todos', 0, 'a/b', 'x~y', ''])).toBe(
      '/todos/0/a~1b/x~0y/'
    )
  })

  it('decodes canonical array indexes while retaining ambiguous forms as strings', () => {
    expect(jsonPointerToPath('/todos/0/12/01/-1/1.0/9007199254740992')).toEqual(
      Result.succeed(['todos', 0, 12, '01', '-1', '1.0', '9007199254740992'])
    )
  })

  it('can preserve every token as a string for numeric-looking object keys', () => {
    expect(
      jsonPointerToPath('/records/0', { numberSegments: 'strings' })
    ).toEqual(Result.succeed(['records', '0']))
  })

  it('decodes escaped tokens in the required order', () => {
    expect(jsonPointerToPath('/~01/~1/~0/')).toEqual(
      Result.succeed(['~1', '/', '~', ''])
    )
  })

  it('returns tagged failures for invalid pointers and escapes', () => {
    expect(jsonPointerToPath('todos/0')).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidPointer', at: 0 },
    })
    expect(jsonPointerToPath('/todos/~2name')).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidEscape', at: 7 },
    })
    expect(jsonPointerToPath('/todos/name~')).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidEscape', at: 11 },
    })
  })
})

describe('getAtPath', () => {
  const root = {
    todos: [{ title: 'first' }, { title: 'second', nested: { done: true } }],
    records: { '0': 'string-key' },
  }

  it('resolves the root and nested own properties', () => {
    expect(getAtPath(root, [])).toEqual(Result.succeed(root))
    expect(getAtPath(root, ['todos', 1, 'title'])).toEqual(
      Result.succeed('second')
    )
    expect(getAtPath(root, ['records', '0'])).toEqual(
      Result.succeed('string-key')
    )
  })

  it('distinguishes invalid indexes, wrong containers, missing values, and primitives', () => {
    expect(getAtPath(root, ['todos', -1])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'InvalidArrayIndex', at: 1 },
    })
    expect(getAtPath(root, ['records', 0])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'ExpectedArray', at: 1 },
    })
    expect(getAtPath(root, ['todos', 3])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'MissingSegment', at: 1 },
    })
    expect(getAtPath(root, ['todos', 0, 'title', 'length'])).toMatchObject({
      _tag: 'Failure',
      failure: {
        reason: 'NotTraversable',
        at: 3,
        traversed: ['todos', 0, 'title'],
      },
    })
  })

  it('does not traverse inherited properties or sparse array holes', () => {
    const inherited = Object.create({ hidden: true }) as Record<string, unknown>
    const sparse = new Array<unknown>(2)

    expect(getAtPath(inherited, ['hidden'])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'MissingSegment' },
    })
    expect(getAtPath(sparse, [0])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'MissingSegment' },
    })
  })

  it('turns property access exceptions into a tagged failure', () => {
    const accessError = new Error('boom')
    const object = Object.defineProperty({}, 'unsafe', {
      get() {
        throw accessError
      },
    })

    expect(() => getAtPath(object, ['unsafe'])).not.toThrow()
    expect(getAtPath(object, ['unsafe'])).toEqual(
      Result.fail({
        _tag: 'GetAtPathFailure',
        reason: 'AccessError',
        path: ['unsafe'],
        at: 0,
        segment: 'unsafe',
        traversed: [],
        cause: accessError,
      })
    )
  })

  it('turns revoked Proxy inspection into a tagged failure', () => {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()

    expect(() => getAtPath(proxy, [0])).not.toThrow()
    expect(getAtPath(proxy, [0])).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'AccessError', at: 0 },
    })
  })
})

describe('path relationships', () => {
  it('detects prefixes, including the root and exact equality', () => {
    expect(isPathPrefix([], ['todos', 0])).toBe(true)
    expect(isPathPrefix(['todos'], ['todos', 0])).toBe(true)
    expect(isPathPrefix(['todos', 0], ['todos', 0])).toBe(true)
    expect(isPathPrefix(['todos', 0], ['todos'])).toBe(false)
    expect(isPathPrefix(['todos', '0'], ['todos', 0])).toBe(false)
  })

  it('treats ancestors and descendants as overlapping, but not siblings', () => {
    expect(pathsOverlap(['todos'], ['todos', 0, 'title'])).toBe(true)
    expect(pathsOverlap(['todos', 0], ['todos'])).toBe(true)
    expect(pathsOverlap(['todos', 0], ['todos', 1])).toBe(false)
    expect(pathsOverlap([], ['anything'])).toBe(true)
  })
})

describe('formatTreePath', () => {
  it('formats paths for diagnostics without losing unusual keys', () => {
    expect(formatTreePath([])).toBe('$')
    expect(formatTreePath(['todos', 2, 'title'])).toBe('$.todos[2].title')
    expect(formatTreePath(['a/b', '', 'with space', 'a"b'])).toBe(
      '$["a/b"][""]["with space"]["a\\"b"]'
    )
  })
})
