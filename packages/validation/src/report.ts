import {
  isPathPrefix,
  pathToJsonPointer,
  type TreePath,
  type TreeSpec,
  type TreeValue,
  walkSchemaValue,
} from '@effect-state-tree/core'
import {
  type CommitGuard,
  type CommitReducer,
  makeCommitReducerController,
  type StoreView,
  type TreeStore,
} from '@effect-state-tree/runtime'
import {
  Effect,
  HashMap,
  Option,
  type Schema,
  type SchemaAST,
  SchemaIssue,
  SchemaParser,
} from 'effect'
import {
  ValidationCodeAnnotation,
  ValidationModeOption,
  type ValidationPhase,
  ValidationPhaseOption,
  type ValidationSeverity,
  ValidationSeverityAnnotation,
} from './lifecycle'

/** Path-indexed leaf projection that retains its original native Schema issue. */
export interface IndexedValidationIssue {
  readonly path: TreePath
  readonly issue: SchemaIssue.Issue
  readonly message: string
  readonly severity: ValidationSeverity
  readonly code?: string
}

/** A revision-specific view of native Effect Schema issues. */
export interface ValidationReport {
  readonly revision: number
  readonly phase: ValidationPhase
  readonly status: 'current'
  /** Retains Schema's composite and alternative issue relationships. */
  readonly issue: Option.Option<SchemaIssue.Issue>
  readonly byPath: HashMap.HashMap<
    string,
    ReadonlyArray<IndexedValidationIssue>
  >
  readonly issues: ReadonlyArray<IndexedValidationIssue>
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

interface IssueMetadata {
  readonly code?: string
  readonly severity: ValidationSeverity
}

const appendPath = (
  prefix: TreePath,
  path: ReadonlyArray<PropertyKey>
): TreePath => [
  ...prefix,
  ...path.map((segment) =>
    typeof segment === 'symbol' ? String(segment) : segment
  ),
]

const metadataFromFilter = (
  issue: SchemaIssue.Filter,
  inherited: IssueMetadata
): IssueMetadata => {
  const code =
    issue.filter.annotations?.[ValidationCodeAnnotation] ?? inherited.code
  return {
    ...(code !== undefined ? { code } : {}),
    severity:
      issue.filter.annotations?.[ValidationSeverityAnnotation] ??
      inherited.severity,
  }
}

const flattenIssue = (
  issue: SchemaIssue.Issue
): ReadonlyArray<IndexedValidationIssue> => {
  const output: Array<IndexedValidationIssue> = []

  const walk = (
    current: SchemaIssue.Issue,
    path: TreePath,
    metadata: IssueMetadata
  ): void => {
    switch (current._tag) {
      case 'Pointer':
        walk(current.issue, appendPath(path, current.path), metadata)
        return
      case 'Filter':
        walk(current.issue, path, metadataFromFilter(current, metadata))
        return
      case 'Encoding':
        walk(current.issue, path, metadata)
        return
      case 'Composite':
      case 'AnyOf':
        for (const nested of current.issues) walk(nested, path, metadata)
        return
      default:
        output.push(
          Object.freeze({
            path: Object.freeze([...path]),
            issue: current,
            message: String(current),
            severity: metadata.severity,
            ...(metadata.code !== undefined ? { code: metadata.code } : {}),
          })
        )
    }
  }

  walk(issue, [], { severity: 'error' })
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

const collectCheckIssues = (
  check: SchemaAST.Check<unknown>,
  value: unknown,
  ast: SchemaAST.AST,
  parseOptions: SchemaAST.ParseOptions,
  output: Array<SchemaIssue.Issue>
): boolean => {
  if (check._tag === 'FilterGroup') {
    for (const nested of check.checks) {
      if (collectCheckIssues(nested, value, ast, parseOptions, output))
        return true
    }
    return false
  }
  // Effect v4 Filter checks are synchronous. Requirements-bearing diagnostics
  // remain explicit Effects outside this interpreter until Schema exposes an
  // effectful native check hook.
  const issue = check.run(value, ast, parseOptions)
  if (issue === undefined) return false
  output.push(new SchemaIssue.Filter(value, check, issue))
  return check.aborted
}

const validateAllChecks = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  phase: ValidationPhase,
  mode: 'admission' | 'diagnostic'
): SchemaIssue.Issue | undefined => {
  const parseOptions: SchemaAST.ParseOptions = {
    errors: 'all',
    onExcessProperty: 'error',
    [ValidationPhaseOption]: phase,
    [ValidationModeOption]: mode,
  }
  const output: Array<SchemaIssue.Issue> = []

  walkSchemaValue(spec, snapshot, ({ asts, path, value }) => {
    const local: Array<SchemaIssue.Issue> = []
    for (const ast of asts) {
      if (ast.checks === undefined) continue
      for (const check of ast.checks) {
        if (collectCheckIssues(check, value, ast, parseOptions, local)) break
      }
    }
    for (const issue of local) {
      output.push(
        path.length === 0 ? issue : new SchemaIssue.Pointer(path, issue)
      )
    }
  })

  const [first, ...rest] = output
  if (first === undefined) return undefined
  return rest.length === 0
    ? first
    : new SchemaIssue.Composite(spec.typeAst, Option.some(snapshot), [
        first,
        ...rest,
      ])
}

/** Interprets one Schema using lifecycle-aware admission or diagnostic policy. */
export const validateTree = <S extends Schema.Constraint>(
  spec: TreeSpec<S>,
  snapshot: TreeValue<S>,
  options: {
    readonly revision?: number
    readonly phase?: ValidationPhase
    readonly mode?: 'admission' | 'diagnostic'
  } = {}
): ValidationReport => {
  const phase = options.phase ?? 'treeMutation'
  const mode = options.mode ?? 'diagnostic'
  const structural = SchemaParser.decodeUnknownResult(spec.typeSchema, {
    errors: 'all',
    onExcessProperty: 'error',
    disableChecks: true,
    [ValidationPhaseOption]: phase,
  })(snapshot)
  const issue =
    structural._tag === 'Failure'
      ? structural.failure
      : validateAllChecks(spec, snapshot, phase, mode)
  const issues = Object.freeze(
    issue === undefined ? [] : [...flattenIssue(issue)]
  )
  return Object.freeze({
    revision: options.revision ?? 0,
    phase,
    status: 'current',
    issue: Option.fromNullishOr(issue),
    byPath: indexIssues(issues),
    issues,
  })
}

/** Commit-guard failure containing the complete revision-specific report. */
export interface ValidationRejectedError {
  readonly _tag: 'ValidationRejectedError'
  readonly report: ValidationReport
}

/** Rejects only the checks configured as hard boundaries for the commit phase. */
export const admissionGuard =
  <S extends Schema.Constraint>(
    spec: TreeSpec<S>,
    phase?: ValidationPhase
  ): CommitGuard<S, ValidationRejectedError> =>
  (proposal) => {
    const report = validateTree(spec, proposal.after, {
      revision: proposal.revisionBefore + 1,
      phase: phase ?? proposal.validationPhase,
      mode: 'admission',
    })
    return Option.isNone(report.issue)
      ? Effect.void
      : Effect.fail({ _tag: 'ValidationRejectedError', report })
  }

/** Live StoreView of the validation sidecar for committed tree revisions. */
export interface ValidationController extends StoreView<ValidationReport> {
  readonly getReport: () => ValidationReport
  readonly issuesAt: (path: TreePath) => ReadonlyArray<IndexedValidationIssue>
  readonly issuesBelow: (
    path: TreePath
  ) => ReadonlyArray<IndexedValidationIssue>
  readonly dispose: () => void
}

/** Maintains a live sidecar report without adding validation data to the tree. */
export const makeValidationController = <S extends Schema.Constraint>(
  store: TreeStore<S>,
  phase?: ValidationPhase
): ValidationController => {
  const reducer: CommitReducer<ValidationReport, S> = {
    initial: validateTree(store.spec, store.getSnapshot(), {
      revision: store.getRevision(),
      phase: phase ?? 'treeMutation',
    }),
    reduce: (_report, commit) => [
      validateTree(store.spec, commit.after, {
        revision: commit.revisionAfter,
        phase: phase ?? commit.validationPhase,
      }),
      [],
    ],
  }
  const live = makeCommitReducerController(store, reducer)

  return {
    getReport: live.getSnapshot,
    getSnapshot: live.getSnapshot,
    subscribe: live.subscribe,
    changes: live.changes,
    issuesAt(path) {
      return validationIssuesAt(live.getSnapshot(), path)
    },
    issuesBelow(path) {
      return validationIssuesBelow(live.getSnapshot(), path)
    },
    dispose: live.dispose,
  }
}
