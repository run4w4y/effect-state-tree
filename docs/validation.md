# Validation

Effect Schema is the only validation language. Effect Tree adds lifecycle
metadata to native v4 Schema filters; it does not introduce a second model or a
parallel validator DSL.

```ts
const Percentage = Schema.Number.check(
  diagnosticCheck(
    'percentage.range',
    (value: number) => value >= 0 && value <= 100
  )
)
```

An unannotated check such as `Schema.Int` is a hard admission constraint. A
lifecycle-aware diagnostic check can be configured per phase as `reject`,
`report`, or `skip`:

- external decoding and construction normally reject;
- live tree mutation and drafts may commit and report;
- persistence normally rejects;
- replication may report according to policy.

The full native `SchemaIssue.Issue` is retained, including `AnyOf`, `Composite`,
`Pointer`, and `Filter` relationships. A derived path index supports UI queries
without flattening away union or parent/child meaning.

Validation reports are ordinary values. Framework adapters subscribe to a
`ValidationController` through the generic `StoreView` protocol, then use the
framework-neutral `validationIssuesAt(report, path)` or
`validationIssuesBelow(report, path)` helpers. Validation therefore does not
add dependencies or plugin-specific hooks to any frontend package.

Structural type mismatches, excess properties, invalid paths, duplicate entity
IDs, identity mutation, aliases, and unsafe mutable atomic objects never become
soft diagnostics; the kernel rejects them.

Effect v4 filter checks are synchronous. Schema encoding and decoding may still
require Effect services and are run as Effects at persistence and CRDT
boundaries. A future Effect v4 facility for effectful native checks can be added
without changing the one-Schema lifecycle model.
