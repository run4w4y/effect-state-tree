# @effect-state-tree/validation

`@effect-state-tree/validation` lets editable state temporarily fail ordinary
Effect Schema checks without weakening the structural guarantees required by an
effect-state-tree.

It provides check-tolerant working tree specifications, complete validation
reports, path-indexed issues, and the most recent revision that passed the
original Schema.

## Availability

This package is not published to a registry. It is available as a
commit-pinned development snapshot; follow the repository's
[development snapshot instructions](https://github.com/run4w4y/effect-state-tree#development-snapshots) and
install matching archives for its internal effect-state-tree dependencies.

The package is ESM-only and expects `effect@4.0.0-beta.99` as a peer dependency.
Every API should be treated as experimental.

## Validate editable state

```ts
import {
  makeValidationControllerScoped,
  makeWorkingTreeSpec,
} from '@effect-state-tree/validation'
import { makeTreeStoreScoped } from '@effect-state-tree/runtime'
import { Effect, Schema } from 'effect'

const Profile = Schema.Struct({
  name: Schema.String,
  age: Schema.Number.pipe(
    Schema.check(Schema.makeFilter((age) => age >= 0))
  ),
})

const program = Effect.gen(function* () {
  const store = yield* makeTreeStoreScoped(
    makeWorkingTreeSpec(Profile),
    { name: 'Ada', age: -1 }
  )
  const validation = yield* makeValidationControllerScoped(Profile, store)

  const report = validation.getReport()
  const ageIssues = validation.issuesAt(['age'])

  return {
    status: report.status,
    messages: ageIssues.map((issue) => issue.message),
  }
})

const result = await Effect.runPromise(Effect.scoped(program))
```

The working tree accepts the structurally correct `{ name: string, age:
number }` value even while `age` fails its non-negative check. It still rejects
wrong structural types, excess properties, invalid entity identity, aliases,
and unsupported mutable values.

## Reports and valid checkpoints

`ValidationController` follows every committed working-tree revision and
exposes:

- `getReport()` for the current `valid` or `invalid` report;
- `issuesAt(path)` for issues indexed exactly at a tuple path;
- `issuesBelow(path)` for issues anywhere under a path;
- `getValidated()` for the most recent fully valid encoded snapshot;
- `subscribe` and `changes` for reactive consumers.

The original native Schema issue tree is retained in each report. The flattened
path index is an additional projection for forms and other user interfaces.

## Standalone validation

Use `validateTree(schema, workingValue, revision)` when no live store is
involved. `decodeWorkingTreeStructure` admits only the editable structure, while
`decodeWorkingTree` performs the original Schema's strict decoding and checks.

Read [Validation and editable state](https://github.com/run4w4y/effect-state-tree/blob/main/docs/validation.md) for the complete
model.

## Related packages

- [`@effect-state-tree/draft`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/draft) combines a working tree,
  validation, and a saved checkpoint.
- [`@effect-state-tree/atom`](https://github.com/run4w4y/effect-state-tree/tree/main/packages/atom) can expose a validation
  controller to a UI as an Atom.
- The [React todo example](https://github.com/run4w4y/effect-state-tree/tree/main/apps/react-todo-example) renders
  path-indexed validation messages from a long-lived draft.
