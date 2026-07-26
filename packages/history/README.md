# @effect-state-tree/history

`@effect-state-tree/history` adds patch-based undo and redo to a live
effect-state-tree store. It records ordinary commits, supports bounded stacks
and grouped actions, and can restore related non-tree state alongside a tree
change.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Attach undo and redo

```ts
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeHistoryScoped } from '@effect-state-tree/history'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Counter = Schema.Struct({ count: Schema.Number })

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(
    makeTreeSpec(Counter),
    { count: 0 }
  )
  const history = yield* makeHistoryScoped(store, { limit: 50 })

  yield* store.update(
    (state) => {
      state.count += 1
    },
    { label: 'Increment' }
  )

  console.log(history.canUndo()) // true
  yield* history.undo
  console.log(store.getSnapshot().count) // 0

  yield* history.redo
  console.log(store.getSnapshot().count) // 1
})

await Effect.runPromise(Effect.scoped(program))
```

Undo and redo are serialized and verify the selected store revision before
applying a history entry. The changes they create are tagged so they do not
record themselves recursively.

## Group and exclude commits

Several commits can become one undo entry:

```ts
import { groupHistory, withoutHistory } from '@effect-state-tree/history'
import { Effect } from 'effect'

const groupedUpdate = groupHistory(
  'Move selection',
  Effect.gen(function* () {
    yield* moveFirstItem
    yield* updateSelection
  })
)

const unrecordedUpdate = withoutHistory(updateTransientUiState)
```

`groupHistory` adds one fiber-local group identity to all nested commits.
`withoutHistory` excludes all nested commits. Both preserve the original Effect
success, error, and requirements.

## History policy

`makeHistory` and `makeHistoryScoped` accept:

- `limit` to retain only the newest undo entries;
- `baselineTags` to clear history after an authoritative baseline change;
- `captureAttached` and `restoreAttached` for related non-tree state.

The controller is also a `StoreView<HistoryState>`, so UI integrations can
subscribe to the undo and redo stacks.

## Related packages

- [`@effect-state-tree/runtime`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/runtime) supplies the live commit
  stream and applies inverse changes.
- [`@effect-state-tree/draft`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/draft) exposes a working store at
  `draft.data`.
- The [React todo example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-todo-example) clears
  history at accepted draft baselines and excludes transient filter changes.
