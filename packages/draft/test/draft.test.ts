import { describe, expect, it } from 'bun:test'
import { Deferred, Effect, Fiber, Option, pipe, Schema } from 'effect'
import {
  DraftDirtyError,
  DraftSynchronizationResult,
  DraftValidationError,
  makeDraft,
  makeDraftScoped,
} from '../src/index'

const Document = Schema.Struct({
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  nested: Schema.Struct({
    count: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
})

const initial = () => ({
  title: 'Initial',
  nested: { count: 1 },
})

describe('validated draft', () => {
  it('maps authoritative payloads without losing synchronization outcomes', () => {
    const result = DraftSynchronizationResult.AcceptedWithPendingChanges({
      authoritative: { title: 'Canonical' },
    })
    const mapped = DraftSynchronizationResult.map(
      result,
      (authoritative) => authoritative.title
    )

    expect(mapped).toEqual({
      _tag: 'AcceptedWithPendingChanges',
      authoritative: 'Canonical',
    })
    expect(
      DraftSynchronizationResult.$match(mapped, {
        Accepted: () => 'accepted',
        AcceptedWithPendingChanges: () => 'pending',
      })
    ).toBe('pending')
    expect(
      pipe(
        result,
        DraftSynchronizationResult.map(
          (authoritative) => authoritative.title.length
        )
      )
    ).toEqual({
      _tag: 'AcceptedWithPendingChanges',
      authoritative: 9,
    })
  })

  it('uses one working tree and aliases its initial saved and valid checkpoints', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))

    expect(draft.getSaved()).toBe(draft.data.getSnapshot())
    expect(Option.getOrThrow(draft.getValidated()).snapshot).toBe(
      draft.data.getSnapshot()
    )
    expect(draft.isDirty()).toBe(false)

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })

  it('keeps invalid edits while retaining structurally shared valid data', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))
    const valid = Option.getOrThrow(draft.getValidated())

    await Effect.runPromise(
      draft.data.update((document) => {
        document.title = ''
      })
    )

    expect(draft.data.getSnapshot().title).toBe('')
    expect(draft.validation.getReport().status).toBe('invalid')
    expect(Option.getOrThrow(draft.getValidated())).toBe(valid)
    expect(draft.data.getSnapshot().nested).toBe(valid.snapshot.nested)
    expect(draft.isDirty()).toBe(true)

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })

  it('resets the working tree to its saved checkpoint', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))

    await Effect.runPromise(
      draft.data.update((document) => {
        document.title = 'Changed'
      })
    )
    await Effect.runPromise(draft.reset)

    expect(draft.data.getSnapshot()).toEqual(initial())
    expect(draft.data.getSnapshot()).toBe(draft.getSaved())
    expect(draft.isDirty()).toBe(false)

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })

  it('refuses to submit the current revision when strict validation fails', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))
    let requested = false

    await Effect.runPromise(
      draft.data.update((document) => {
        document.title = ''
      })
    )
    const exit = await Effect.runPromiseExit(
      draft.submit(() => {
        requested = true
        return Effect.succeed(initial())
      })
    )

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      expect(String(exit.cause)).toContain(DraftValidationError.name)
    }
    expect(requested).toBe(false)

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })

  it('moves the saved checkpoint to the authoritative accepted snapshot', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))
    await Effect.runPromise(
      draft.data.update((document) => {
        document.title = 'Submitted'
      })
    )

    const result = await Effect.runPromise(
      draft.submit(({ submitted }) => {
        expect(submitted.title).toBe('Submitted')
        return Effect.succeed({
          ...submitted,
          title: 'Canonical',
        })
      })
    )

    expect(result._tag).toBe('Accepted')
    expect(draft.data.getSnapshot().title).toBe('Canonical')
    expect(draft.getSaved()).toBe(draft.data.getSnapshot())
    expect(draft.isDirty()).toBe(false)

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })

  it('advances only the saved checkpoint when edits arrive during submission', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const draft = yield* makeDraftScoped(Document, initial())
          yield* draft.data.update((document) => {
            document.title = 'Submitted'
          })
          const started = yield* Deferred.make<void>()
          const response =
            yield* Deferred.make<Schema.Schema.Type<typeof Document>>()
          const submitting = yield* draft
            .submit(() =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(response))
              )
            )
            .pipe(Effect.forkScoped)

          yield* Deferred.await(started)
          yield* draft.data.update((document) => {
            document.nested.count = 2
          })
          yield* Deferred.succeed(response, {
            title: 'Canonical',
            nested: { count: 1 },
          })
          const result = yield* Fiber.join(submitting)

          expect(result._tag).toBe('AcceptedWithPendingChanges')
          expect(draft.getSaved().title).toBe('Canonical')
          expect(draft.data.getSnapshot()).toEqual({
            title: 'Submitted',
            nested: { count: 2 },
          })
          expect(draft.isDirty()).toBe(true)
        })
      )
    )
  })

  it('rejects authoritative refresh while the draft is dirty', async () => {
    const draft = await Effect.runPromise(makeDraft(Document, initial()))
    await Effect.runPromise(
      draft.data.update((document) => {
        document.title = 'Changed'
      })
    )

    const exit = await Effect.runPromiseExit(draft.refresh(initial()))
    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      expect(String(exit.cause)).toContain(DraftDirtyError.name)
    }

    draft.dispose()
    await Effect.runPromise(draft.data.shutdown)
  })
})
