# @effect-state-tree/atom

`@effect-state-tree/atom` projects effect-state-tree stores, selectors, runtime
views, and Effect actions into Effect Atom.

The integration is framework-neutral. React applications use the official
`@effect/atom-react` binding; other official Effect Atom framework bindings can
consume the same atoms.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for `@effect-state-tree/core`,
`@effect-state-tree/runtime`, and this package.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Effect Atom currently lives under Effect's unstable reactivity API, and every
API in this package should be treated as experimental.

## Create selectors and function atoms

```tsx
import {
  RegistryProvider,
  useAtom,
  useAtomValue,
} from '@effect/atom-react'
import { makeTreeSpec } from '@effect-state-tree/core'
import { makeTreeAtoms } from '@effect-state-tree/atom'
import { defineTree } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Counter = Schema.Struct({ count: Schema.Number })
const CounterTree = defineTree(
  '@example/CounterTree',
  makeTreeSpec(Counter)
)
const increment = CounterTree.update(
  (state, amount: number) => {
    state.count += amount
  },
  { label: 'Increment' }
)

const store = await Effect.runPromise(CounterTree.make({ count: 0 }))
const atoms = makeTreeAtoms(CounterTree, store)
const countAtom = atoms.select(
  (state) => state.count,
  { paths: [['count']] }
)
const incrementAtom = atoms.fn(increment)

const CounterView = () => {
  const count = useAtomValue(countAtom)
  const [result, runIncrement] = useAtom(incrementAtom)

  return (
    <button
      disabled={result.waiting}
      onClick={() => runIncrement(1)}
    >
      Count: {count}
    </button>
  )
}

export const App = () => (
  <RegistryProvider>
    <CounterView />
  </RegistryProvider>
)
```

The application owns the store's lifetime and should run `store.shutdown` when
the store is no longer needed.

## TreeAtoms

`makeTreeAtoms` returns one stable projection containing:

- `snapshot`, an Atom for the complete current snapshot;
- `select`, for path-aware tree selectors;
- `view`, for any runtime `StoreView`, including validation and history;
- `fn`, the native Atom runtime function constructor with the tree service
  already provided;
- `runtime`, for creating other native Effect Atoms in the same environment;
- the original `definition` and `store`.

`makeTreeAtomsWithLayer` merges an application Layer into the Atom runtime.
Use it when function atoms also need API clients, repositories, configuration,
or other Effect services.

Function atoms retain native Effect Atom `AsyncResult`, interruption, reset,
concurrency, and reactivity behavior. This package does not introduce a second
command abstraction.

## Lower-level adapters

Use `atomFromTreeSelector(store, selector, options)` for one selector without a
tree definition. `atomFromView(view)` adapts any framework-neutral
`StoreView<A>` and subscribes only while the Atom is mounted.

## Real application examples

- The [React todo example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-todo-example) combines
  selectors, Atom families, validation, history, drafts, and Effect services.
- The [React Loro collaboration
  example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-loro-collaboration-example) projects a
  store, connection state, commit feed, and collaborative actions.
