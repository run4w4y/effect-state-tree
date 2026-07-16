import type { TreeValue } from '@effect-state-tree/core'
import type {
  CommandExecutionOptions,
  SelectOptions,
  StoreView,
  TreeStore,
} from '@effect-state-tree/runtime'
import type { Effect, Schema } from 'effect'
import { Atom } from 'effect/unstable/reactivity'

/** Converts any framework-neutral StoreView into a scoped Effect Atom. */
export const atomFromView = <A>(view: StoreView<A>): Atom.Atom<A> =>
  Atom.readable((context) => {
    context.addFinalizer(
      view.subscribe(() => context.setSelf(view.getSnapshot()))
    )
    return view.getSnapshot()
  })

/** Creates an atom backed by one path-aware tree selector. */
export const atomFromTreeSelector = <S extends Schema.Constraint, A>(
  store: TreeStore<S>,
  selector: (snapshot: TreeValue<S>) => A,
  options?: SelectOptions<A>
): Atom.Atom<A> => atomFromView(store.select(selector, options))

/**
 * Creates an Effect Atom function for a typed command, preserving the runtime
 * error channel and Atom cancellation/execution semantics.
 */
export const atomCommand = <R, ER, Arg, A, E>(
  runtime: Atom.AtomRuntime<R, ER>,
  run: (argument: Arg) => Effect.Effect<A, E, R>,
  options?: CommandExecutionOptions & {
    readonly initialValue?: A
  }
): Atom.AtomResultFn<Arg, A, E | ER> =>
  runtime.fn<Arg>()((argument) => run(argument), {
    initialValue: options?.initialValue,
    concurrent: options?.execution === 'merge',
  })
