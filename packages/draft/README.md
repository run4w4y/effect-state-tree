# @effect-state-tree/draft

`@effect-state-tree/draft` provides a validated working copy with a saved
checkpoint. It is intended for forms, editors, and request workflows where
local changes may be invalid or may continue while an authoritative save is in
flight.

A draft owns one check-tolerant tree, its validation controller, and operations
for reset, clean refresh, and race-safe submission reconciliation.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Edit and submit a draft

```ts
import { makeDraftScoped } from '@effect-state-tree/draft'
import { Effect, Schema } from 'effect'

const Profile = Schema.Struct({
  name: Schema.String,
  age: Schema.Number.pipe(
    Schema.check(Schema.makeFilter((age) => age >= 0))
  ),
})

const program = Effect.gen(function* () {
  const draft = yield* makeDraftScoped(Profile, {
    name: 'Ada',
    age: 36,
  })

  yield* draft.data.update((profile) => {
    profile.age = -1
  })

  console.log(draft.isDirty()) // true
  console.log(draft.validation.getReport().status) // "invalid"

  yield* draft.reset

  yield* draft.data.update((profile) => {
    profile.name = 'Ada Lovelace'
  })

  return yield* draft.submit(({ submitted }) =>
    Effect.succeed(submitted)
  )
})

const result = await Effect.runPromise(Effect.scoped(program))
```

`submit` strictly decodes the working revision before calling the request. An
invalid draft fails with `DraftValidationError`, so the request does not run.

## Submission reconciliation

The request receives an immutable `DraftSubmissionContext` containing:

- `submitted`: the strictly decoded value;
- `working`: the exact encoded working snapshot;
- `saved`: the checkpoint current when submission began;
- `revision`: the working-tree revision captured for the request.

When the request succeeds, its authoritative response is reconciled against the
submitted revision. The result is:

- `Accepted` when the authoritative response became the current working value;
- `AcceptedWithPendingChanges` when newer edits remain in the draft.

An expected failure may also expose an authoritative value through
`authoritativeFailure`. This updates the saved baseline without silently
discarding current local edits.

## Refresh and reset

- `reset` replaces the working value with the saved checkpoint.
- `refresh(authoritative)` installs a valid authoritative value only while the
  draft is clean; otherwise it fails with `DraftDirtyError`.
- `getSaved()` and `isDirty()` expose the current checkpoint relationship.
- `getValidated()` exposes the latest working revision that passed the strict
  Schema.

Prefer `makeDraftScoped` so the working store and subscriptions are released
with the surrounding Effect Scope.

## Related packages

- [`@effect-state-tree/validation`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/validation) supplies the
  working Schema and validation reports.
- [`@effect-state-tree/history`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/history) can attach undo and redo
  to `draft.data`.
- The [React todo example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-todo-example) demonstrates
  optimistic version checks, in-flight edits, conflicts, reset, and save
  reconciliation.
