import { describe, expect, it } from 'bun:test'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeStore } from '@effect-state-tree/runtime'
import { Effect, Option, Schema, SchemaParser } from 'effect'
import {
  admissionGuard,
  diagnosticCheck,
  makeValidationController,
  validateTree,
  validationIssuesAt,
  validationIssuesBelow,
} from '../src/index'

const Percentage = Schema.Number.check(
  diagnosticCheck(
    'percentage.range',
    (value: number) => value >= 0 && value <= 100,
    { expected: 'a percentage between 0 and 100' }
  )
)

const State = Schema.Struct({
  percentage: Percentage,
  minimum: Schema.Number,
  maximum: Schema.Number,
}).check(
  diagnosticCheck('range.order', (value) =>
    value.minimum <= value.maximum
      ? undefined
      : { path: ['maximum'], issue: 'maximum must not be below minimum' }
  )
)

const spec = makeTreeSpec(State)

describe('Schema lifecycle validation', () => {
  it('uses one Schema while allowing diagnostic intermediate domain values', async () => {
    const external = SchemaParser.decodeUnknownResult(spec.typeSchema, {
      errors: 'all',
    })({ percentage: 150, minimum: 0, maximum: 10 })
    expect(external._tag).toBe('Failure')

    const store = await Effect.runPromise(
      makeTreeStore(spec, { percentage: 50, minimum: 0, maximum: 10 })
    )
    const validation = makeValidationController(store)

    const committed = await Effect.runPromise(
      store.update(
        (state) => {
          state.percentage = 150
        },
        { guard: admissionGuard(spec) }
      )
    )

    expect(committed._tag).toBe('Committed')
    expect(store.getSnapshot().percentage).toBe(150)
    expect(validation.getReport().issues).toEqual([
      expect.objectContaining({
        path: ['percentage'],
        code: 'percentage.range',
        severity: 'error',
      }),
    ])
    validation.dispose()
  })

  it('rejects structural violations and phases configured as hard boundaries', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(spec, { percentage: 50, minimum: 0, maximum: 10 })
    )

    const structural = await Effect.runPromiseExit(
      store.apply(
        {
          patches: {
            forward: [
              { op: 'replace', path: ['percentage'], value: 'not a number' },
            ],
            inverse: [],
          },
        },
        { guard: admissionGuard(spec) }
      )
    )
    expect(structural._tag).toBe('Failure')
    expect(store.getSnapshot().percentage).toBe(50)

    const persistence = validateTree(
      spec,
      { percentage: 150, minimum: 0, maximum: 10 },
      { phase: 'persistence', mode: 'admission' }
    )
    expect(Option.isSome(persistence.issue)).toBe(true)
  })

  it('retains native issue structure and indexes cross-field paths', () => {
    const report = validateTree(
      spec,
      { percentage: 150, minimum: 10, maximum: 0 },
      { phase: 'treeMutation' }
    )
    expect(
      Option.isSome(report.issue) ? report.issue.value._tag : undefined
    ).toBe('Composite')
    expect(report.issues.map((issue) => issue.code).toSorted()).toEqual([
      'percentage.range',
      'range.order',
    ])
    expect(validationIssuesAt(report, ['maximum'])[0]?.message).toContain(
      'maximum'
    )
    expect(
      validationIssuesBelow(report, []).map((issue) => issue.code)
    ).toEqual(report.issues.map((issue) => issue.code))
  })

  it('retains checks declared on Union wrappers', () => {
    const Choice = Schema.Union([
      Schema.Struct({ _tag: Schema.Literal('a'), value: Schema.Number }),
      Schema.Struct({ _tag: Schema.Literal('b'), value: Schema.Number }),
    ]).check(diagnosticCheck('choice.positive', (value) => value.value > 0))
    const report = validateTree(
      makeTreeSpec(Schema.Struct({ choice: Choice })),
      { choice: { _tag: 'a' as const, value: -1 } }
    )

    expect(report.issues).toEqual([
      expect.objectContaining({
        path: ['choice'],
        code: 'choice.positive',
      }),
    ])
  })

  it('interprets the lifecycle phase carried by each commit', async () => {
    const store = await Effect.runPromise(
      makeTreeStore(spec, { percentage: 50, minimum: 0, maximum: 10 })
    )
    const validation = makeValidationController(store)

    await Effect.runPromise(
      store.update(
        (state) => {
          state.percentage = 150
        },
        {
          validationPhase: 'draft',
          guard: admissionGuard(spec),
        }
      )
    )

    expect(validation.getReport().phase).toBe('draft')
    expect(validation.getReport().issues[0]?.code).toBe('percentage.range')
    validation.dispose()
  })
})
