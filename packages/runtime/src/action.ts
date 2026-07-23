import { Effect, type Schema } from 'effect'
import { withCommitContext } from './context'
import type { TreeDefinition, TreeStoreIdentifier } from './service'
import { TransactionIds } from './transaction-id'

/** Effect workflow derived from a tree definition and resolved from Context. */
export interface TreeAction<
  Id extends string,
  S extends Schema.Constraint,
  Input,
  A,
  E = never,
  R = never,
> {
  /** Runs the workflow with its tree store and remaining services from Context. */
  (input: Input): Effect.Effect<A, E, TreeStoreIdentifier<Id, S> | R>
  /** Span name and default commit label shared by this action execution. */
  readonly actionName: string
  /** Tree definition whose store is required by the action. */
  readonly definition: TreeDefinition<Id, S>
}

/** Implementation used by `TreeDefinition.action`. */
export const makeTreeAction = <
  const Id extends string,
  S extends Schema.Constraint,
  Input = void,
  A = void,
  E = never,
  R = never,
>(
  definition: TreeDefinition<Id, S>,
  name: string,
  handler: (input: Input) => Effect.Effect<A, E, R>
): TreeAction<Id, S, Input, A, E, R> => {
  const run = Effect.fn(name)(function* (input: Input) {
    yield* definition.service
    const ids = yield* TransactionIds
    const id = yield* ids.next
    return yield* withCommitContext(handler(input), {
      action: Object.freeze({ id, name }),
      label: name,
    })
  })

  return Object.assign(run, { actionName: name, definition })
}
