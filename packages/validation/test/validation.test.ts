import { describe, expect, it } from 'bun:test'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Option, Result, Schema } from 'effect'
import {
  decodeWorkingTree,
  makeValidationController,
  makeValidationControllerScoped,
  makeWorkingTreeSpec,
  type ValidationController,
  validateTree,
  validationIssuesAt,
  validationIssuesBelow,
} from '../src/index'

const Percentage = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => value >= 0 && value <= 100))
)

const State = Schema.Struct({
  percentage: Percentage,
  minimum: Schema.Number,
  maximum: Schema.Number,
}).pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      value.minimum <= value.maximum
        ? undefined
        : { path: ['maximum'], issue: 'maximum must not be below minimum' }
    )
  )
)

describe('validated working trees', () => {
  it('accepts check-invalid working values and retains the latest valid checkpoint', async () => {
    const Document = Schema.Struct({
      title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
      untouched: Schema.Struct({ value: Schema.Number }),
    })
    const store = await Effect.runPromise(
      makeTreeStore(makeWorkingTreeSpec(Document), {
        title: 'Ready',
        untouched: { value: 1 },
      })
    )
    const validation = makeValidationController(Document, store)
    const initialCheckpoint = Option.getOrThrow(validation.getValidated())

    await Effect.runPromise(
      store.update((state) => {
        state.title = ''
      })
    )

    expect(store.getSnapshot().title).toBe('')
    expect(validation.getReport().status).toBe('invalid')
    expect(validation.getReport().issues).toHaveLength(1)
    expect(validation.getValidated()).toEqual(Option.some(initialCheckpoint))
    expect(store.getSnapshot().untouched).toBe(
      initialCheckpoint.snapshot.untouched
    )
    validation.dispose()
  })

  it('advances the validated pointer only when the complete revision passes', async () => {
    const spec = makeWorkingTreeSpec(State)
    const store = await Effect.runPromise(
      makeTreeStore(spec, { percentage: 50, minimum: 0, maximum: 10 })
    )
    const validation = makeValidationController(State, store)
    const initial = Option.getOrThrow(validation.getValidated())

    await Effect.runPromise(
      store.update((state) => {
        state.percentage = 150
      })
    )
    expect(validation.getReport().status).toBe('invalid')
    expect(Option.getOrThrow(validation.getValidated()).revision).toBe(
      initial.revision
    )

    await Effect.runPromise(
      store.update((state) => {
        state.percentage = 75
      })
    )
    expect(validation.getReport().status).toBe('valid')
    expect(Option.getOrThrow(validation.getValidated())).toMatchObject({
      revision: 2,
      snapshot: { percentage: 75 },
    })
    validation.dispose()
  })

  it('continues to reject structural violations at the tree boundary', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(makeWorkingTreeSpec(State), {
        percentage: 50,
        minimum: 0,
        maximum: 10,
      })
    )

    const structural = await Effect.runPromiseExit(
      store.apply({
        patches: {
          forward: [
            { op: 'replace', path: ['percentage'], value: 'not a number' },
          ],
          inverse: [],
        },
      })
    )

    expect(structural._tag).toBe('Failure')
    expect(store.getSnapshot().percentage).toBe(50)
  })

  it('indexes native cross-field issues without custom annotations', () => {
    const report = validateTree(
      State,
      { percentage: 50, minimum: 10, maximum: 0 },
      7
    )

    expect(report.status).toBe('invalid')
    expect(report.revision).toBe(7)
    expect(report.issues).toHaveLength(1)
    expect(validationIssuesAt(report, ['maximum'])[0]?.message).toContain(
      'maximum'
    )
    expect(validationIssuesBelow(report, [])).toEqual(report.issues)
  })

  it('uses the encoded side as the honest working type', () => {
    const Count = Schema.NumberFromString.pipe(
      Schema.check(Schema.isGreaterThan(0))
    )
    const spec = makeWorkingTreeSpec(Count)

    expect(spec.typeSchema.make('12')).toBe('12')
    expect(decodeWorkingTree(Count, '12')).toEqual(Result.succeed(12))
    expect(Result.isFailure(decodeWorkingTree(Count, 'nope'))).toBe(true)
  })

  it('retains checks declared on Union wrappers', () => {
    const Choice = Schema.Union([
      Schema.Struct({ _tag: Schema.Literal('a'), value: Schema.Number }),
      Schema.Struct({ _tag: Schema.Literal('b'), value: Schema.Number }),
    ]).pipe(Schema.check(Schema.makeFilter((value) => value.value > 0)))
    const Document = Schema.Struct({ choice: Choice })
    const report = validateTree(Document, {
      choice: { _tag: 'a', value: -1 },
    })

    expect(report.status).toBe('invalid')
    expect(report.issues).toEqual([
      expect.objectContaining({
        path: ['choice'],
      }),
    ])
  })

  it('stops observing commits when its surrounding Scope closes', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(makeWorkingTreeSpec(State), {
        percentage: 50,
        minimum: 0,
        maximum: 10,
      })
    )
    let validation: ValidationController<typeof State> | undefined

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          validation = yield* makeValidationControllerScoped(State, store)
          yield* store.update((state) => {
            state.percentage = 75
          })
          expect(validation.getReport().revision).toBe(1)
        })
      )
    )

    if (validation === undefined) throw new Error('Expected scoped validation')
    await Effect.runPromise(
      store.update((state) => {
        state.percentage = 80
      })
    )
    expect(validation.getReport().revision).toBe(1)
    await Effect.runPromise(store.shutdown)
  })
})
