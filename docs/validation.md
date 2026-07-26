# Validation and editable state

effect-state-tree uses Effect Schema as its only validation language. It does
not add a second rule format for forms or drafts.

Editable state creates an important distinction:

- the tree must always have the correct structure;
- ordinary Schema checks may be temporarily invalid while a person edits it.

For example, a form can hold `-1` while someone is replacing an age, but it
cannot turn the age field into an object or introduce an unknown property.

## Working trees

`makeWorkingTreeSpec` derives an editable specification from the encoded side of
the original Schema:

```ts
import { makeTreeStore } from '@effect-state-tree/runtime'
import {
  makeValidationController,
  makeWorkingTreeSpec,
} from '@effect-state-tree/validation'
import { Effect, Schema } from 'effect'

const Profile = Schema.Struct({
  name: Schema.String,
  age: Schema.Number.pipe(
    Schema.check(Schema.makeFilter((age) => age >= 0))
  ),
})

const program = Effect.gen(function* () {
  const store = yield* makeTreeStore(
    makeWorkingTreeSpec(Profile),
    { name: 'Ada', age: -1 }
  )
  const validation = makeValidationController(Profile, store)

  const report = validation.getReport()
  const ageIssues = validation.issuesAt(['age'])

  return { report, ageIssues }
})
```

The working tree skips ordinary checks when admitting edits, while retaining
the Schema's structural rules. The validation controller strictly checks every
committed revision against the original Schema.

## Reports and checkpoints

A validation report has a revision and a `valid` or `invalid` status. It retains
the original Effect Schema issue tree and also provides a path index for user
interfaces:

```ts
const current = validation.getReport()
const titleIssues = validation.issuesAt(['title'])
const sectionIssues = validation.issuesBelow(['sections', 0])
```

When a complete revision is valid, the controller records it as the latest
validated checkpoint. A later invalid edit does not discard that checkpoint.
This lets an application distinguish:

- the value currently being edited;
- the most recent value known to satisfy the complete Schema.

## Drafts

`makeDraft` combines a working tree, validation controller, and saved
checkpoint:

```ts
import { makeDraft } from '@effect-state-tree/draft'

const draft = yield* makeDraft(Profile, {
  name: 'Ada',
  age: 36,
})

const report = draft.validation.getReport()
const dirty = draft.isDirty()
```

A draft can reset to its saved value, accept an authoritative refresh while
clean, or submit its current valid revision. If local edits occur while a
request is in flight, response reconciliation preserves those newer edits
instead of silently overwriting them.

## Hard tree errors

Some failures are never treated as editable validation issues. The tree rejects
them immediately:

- structural type mismatches and excess properties;
- invalid paths or patch preconditions;
- duplicate entity IDs or identity changes;
- the same object attached at multiple paths;
- unsupported mutable native values.

This boundary ensures that every working revision remains safe to patch,
compare, reconcile, and observe even when ordinary domain checks are failing.
