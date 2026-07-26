import {
  isPathPrefix,
  makeTreeSpec,
  pathToJsonPointer,
  type TreePath,
  type TreeSpec,
  type TreeSpecOptions,
} from '@effect-state-tree/core'
import {
  type CommitReducer,
  makeCommitReducerController,
  type StoreView,
  type TreeStore,
} from '@effect-state-tree/runtime'
import {
  Effect,
  HashMap,
  Option,
  type Result,
  Schema,
  type SchemaIssue,
  SchemaParser,
  type Scope,
  Stream,
} from 'effect'

/** Encoded, structurally editable value accepted by a validated tree. */
export type WorkingValue<S extends Schema.Constraint> = S['Encoded']

/** Encoded-side Schema whose own parser admits check-invalid working values. */
export type WorkingSchema<S extends Schema.Constraint> = Schema.toEncoded<S>

/** Derives the check-tolerant encoded Schema used by an editable working tree. */
export const makeWorkingSchema = <S extends Schema.Constraint>(
  schema: S
): WorkingSchema<S> =>
  Schema.toEncoded(schema).annotate({
    parseOptions: { disableChecks: true },
  })

/** Compiles the validation-owned working Schema as an ordinary strict tree. */
export const makeWorkingTreeSpec = <S extends Schema.Constraint>(
  schema: S,
  options: TreeSpecOptions = {}
): TreeSpec<WorkingSchema<S>> =>
  makeTreeSpec(makeWorkingSchema(schema), options)

/** Path-indexed projection retaining its original native Schema issue. */
export interface IndexedValidationIssue {
  /** Tuple path at which the issue is indexed. */
  readonly path: TreePath
  /** Original native Effect Schema issue. */
  readonly issue: SchemaIssue.Issue
  /** Formatted issue message. */
  readonly message: string
}

/** Strict validation result for one working-tree revision. */
export interface ValidationReport {
  /** Working-tree revision for which this report was produced. */
  readonly revision: number
  /** Whether the complete revision passed the original Schema. */
  readonly status: 'invalid' | 'valid'
  /** Retains Schema's composite and alternative issue relationships. */
  readonly issue: Option.Option<SchemaIssue.Issue>
  /** Exact-path index for convenient UI queries. */
  readonly byPath: HashMap.HashMap<
    string,
    ReadonlyArray<IndexedValidationIssue>
  >
  /** Flattened projection retaining each native issue. */
  readonly issues: ReadonlyArray<IndexedValidationIssue>
}

/** Structurally shared working snapshot proven valid at one revision. */
export interface ValidatedCheckpoint<S extends Schema.Constraint> {
  /** Revision at which the complete working snapshot passed strict decoding. */
  readonly revision: number
  /** Encoded working snapshot retained without allocating a decoded duplicate. */
  readonly snapshot: WorkingValue<S>
}

/** Returns the validation issues indexed at exactly one tree path. */
export const validationIssuesAt = (
  report: ValidationReport,
  path: TreePath
): ReadonlyArray<IndexedValidationIssue> =>
  Option.getOrElse(
    HashMap.get(report.byPath, pathToJsonPointer(path)),
    () => []
  )

/** Returns every validation issue at or below one tree path. */
export const validationIssuesBelow = (
  report: ValidationReport,
  path: TreePath
): ReadonlyArray<IndexedValidationIssue> =>
  report.issues.filter((issue) => isPathPrefix(path, issue.path))

const appendPath = (
  prefix: TreePath,
  path: ReadonlyArray<PropertyKey>
): TreePath => [
  ...prefix,
  ...path.map((segment) =>
    typeof segment === 'symbol' ? String(segment) : segment
  ),
]

const flattenIssue = (
  issue: SchemaIssue.Issue
): ReadonlyArray<IndexedValidationIssue> => {
  const output: Array<IndexedValidationIssue> = []

  const walk = (current: SchemaIssue.Issue, path: TreePath): void => {
    switch (current._tag) {
      case 'Pointer':
        walk(current.issue, appendPath(path, current.path))
        return
      case 'Filter':
      case 'Encoding':
        walk(current.issue, path)
        return
      case 'Composite':
      case 'AnyOf':
        for (const nested of current.issues) walk(nested, path)
        return
      default:
        output.push(
          Object.freeze({
            path: Object.freeze([...path]),
            issue: current,
            message: String(current),
          })
        )
    }
  }

  walk(issue, [])
  return output
}

const indexIssues = (
  issues: ReadonlyArray<IndexedValidationIssue>
): HashMap.HashMap<string, ReadonlyArray<IndexedValidationIssue>> => {
  let index = HashMap.empty<string, ReadonlyArray<IndexedValidationIssue>>()
  for (const issue of issues) {
    const key = pathToJsonPointer(issue.path)
    const current = HashMap.get(index, key)
    index = HashMap.set(
      index,
      key,
      Option.isNone(current)
        ? Object.freeze([issue])
        : Object.freeze([...current.value, issue])
    )
  }
  return index
}

/** Admits the encoded working shape while deliberately skipping checks. */
export const decodeWorkingTreeStructure = <S extends Schema.Constraint>(
  schema: S,
  input: unknown
): Result.Result<WorkingValue<S>, SchemaIssue.Issue> =>
  SchemaParser.decodeUnknownResult(makeWorkingSchema(schema), {
    errors: 'all',
    onExcessProperty: 'error',
  })(input)

/** Strictly decodes one working snapshot with the original Effect Schema. */
export const decodeWorkingTree = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  snapshot: WorkingValue<S>
): Result.Result<S['Type'], SchemaIssue.Issue> =>
  SchemaParser.decodeUnknownResult(schema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(snapshot)

/** Validates one working snapshot without retaining a decoded duplicate. */
export const validateTree = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  snapshot: WorkingValue<S>,
  revision = 0
): ValidationReport => {
  const decoded = decodeWorkingTree(schema, snapshot)
  const issue = decoded._tag === 'Failure' ? decoded.failure : undefined
  const issues = Object.freeze(
    issue === undefined ? [] : [...flattenIssue(issue)]
  )
  return Object.freeze({
    revision,
    status: issue === undefined ? 'valid' : 'invalid',
    issue: Option.fromNullishOr(issue),
    byPath: indexIssues(issues),
    issues,
  })
}

interface ValidationState<S extends Schema.Constraint> {
  readonly report: ValidationReport
  readonly validated: Option.Option<ValidatedCheckpoint<S>>
}

const validationState = <S extends Schema.Constraint>(
  report: ValidationReport,
  snapshot: WorkingValue<S>,
  previous: Option.Option<ValidatedCheckpoint<S>>
): ValidationState<S> => ({
  report,
  validated:
    report.status === 'valid'
      ? Option.some(
          Object.freeze({
            revision: report.revision,
            snapshot,
          })
        )
      : previous,
})

/** Live strict validation and latest-valid checkpoint for a working tree. */
export interface ValidationController<S extends Schema.Constraint>
  extends StoreView<ValidationReport> {
  /** Reads the current revision-specific report synchronously. */
  readonly getReport: () => ValidationReport
  /** Reads the latest completely valid checkpoint on the working branch. */
  readonly getValidated: () => Option.Option<ValidatedCheckpoint<S>>
  /** Returns issues indexed at exactly one tuple path. */
  readonly issuesAt: (path: TreePath) => ReadonlyArray<IndexedValidationIssue>
  /** Returns issues indexed at or below one tuple path. */
  readonly issuesBelow: (
    path: TreePath
  ) => ReadonlyArray<IndexedValidationIssue>
  /** Stops observing tree commits. */
  readonly dispose: () => void
}

/** Maintains strict validation beside a check-tolerant working tree. */
export const makeValidationController = <
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: S,
  store: TreeStore<WorkingSchema<S>>
): ValidationController<S> => {
  const initialReport = validateTree(
    schema,
    store.getSnapshot(),
    store.getRevision()
  )
  const reducer: CommitReducer<ValidationState<S>, WorkingSchema<S>> = {
    initial: validationState(initialReport, store.getSnapshot(), Option.none()),
    reduce: (state, commit) => [
      validationState(
        validateTree(schema, commit.after, commit.revisionAfter),
        commit.after,
        state.validated
      ),
      [],
    ],
  }
  const live = makeCommitReducerController(store, reducer)
  const getReport = () => live.getSnapshot().report

  return {
    getReport,
    getSnapshot: getReport,
    getValidated: () => live.getSnapshot().validated,
    subscribe: live.subscribe,
    changes: Stream.map(live.changes, (state) => state.report),
    issuesAt(path) {
      return validationIssuesAt(getReport(), path)
    },
    issuesBelow(path) {
      return validationIssuesBelow(getReport(), path)
    },
    dispose: live.dispose,
  }
}

/** Maintains strict validation for the surrounding Effect Scope. */
export const makeValidationControllerScoped = <
  S extends Schema.ConstraintDecoder<unknown>,
>(
  schema: S,
  store: TreeStore<WorkingSchema<S>>
): Effect.Effect<ValidationController<S>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => makeValidationController(schema, store)),
    (validation) => Effect.sync(validation.dispose)
  )
