import {
  type TreeValidationMode,
  TreeValidationModeOption,
  type TreeValidationPhase,
  TreeValidationPhaseOption,
} from '@effect-state-tree/core'
import { Schema, type SchemaAST } from 'effect'

export const ValidationPhaseOption = TreeValidationPhaseOption
export const ValidationModeOption = TreeValidationModeOption
export const LifecyclePolicyAnnotation =
  '@effect-state-tree/lifecycle-policy' as const
export const ValidationCodeAnnotation =
  '@effect-state-tree/validation-code' as const
export const ValidationSeverityAnnotation =
  '@effect-state-tree/validation-severity' as const

/** Tree lifecycle boundary supplied to native Effect Schema checks. */
export type ValidationPhase = TreeValidationPhase
/** Admission rejects while diagnostic mode retains reportable failures. */
export type ValidationMode = TreeValidationMode
/** Consequence of one Schema check at one tree lifecycle boundary. */
export type CheckPolicy = 'reject' | 'report' | 'skip'
/** User-facing severity retained in the validation sidecar. */
export type ValidationSeverity = 'info' | 'warning' | 'error'

/** Per-phase policy attached to a native Effect Schema filter. */
export type LifecyclePolicy = Readonly<
  Partial<Record<ValidationPhase, CheckPolicy>>
>

declare module 'effect/SchemaAST' {
  interface ParseOptions {
    readonly '@effect-state-tree/validation-phase'?: ValidationPhase | undefined
    readonly '@effect-state-tree/validation-mode'?: ValidationMode | undefined
  }
}

declare module 'effect/Schema' {
  namespace Annotations {
    interface Filter {
      readonly '@effect-state-tree/lifecycle-policy'?:
        | LifecyclePolicy
        | undefined
      readonly '@effect-state-tree/validation-code'?: string | undefined
      readonly '@effect-state-tree/validation-severity'?:
        | ValidationSeverity
        | undefined
    }
  }
}

/** Stable diagnostics metadata and per-phase behavior for a Schema filter. */
export interface LifecycleCheckOptions {
  readonly code: string
  readonly severity?: ValidationSeverity
  readonly policy?: LifecyclePolicy
  readonly expected?: string
}

const policyFor = (
  policy: LifecyclePolicy,
  phase: ValidationPhase
): CheckPolicy => policy[phase] ?? 'reject'

const shouldRun = (
  policy: LifecyclePolicy,
  phase: ValidationPhase,
  mode: ValidationMode | undefined
): boolean => {
  const selected = policyFor(policy, phase)
  if (selected === 'skip') return false
  if (mode === 'admission') return selected === 'reject'
  if (mode === 'diagnostic')
    return selected === 'reject' || selected === 'report'
  return true
}

/** Wraps a native Schema filter with tree lifecycle annotations and policy. */
export const lifecycleCheck = <A>(
  validate: (value: A, ast: SchemaAST.AST) => Schema.FilterOutput,
  options: LifecycleCheckOptions
): SchemaAST.Filter<A> => {
  const policy = options.policy ?? {}
  return Schema.makeFilter(
    (value, ast, parseOptions) => {
      const phase = parseOptions[ValidationPhaseOption] ?? 'externalDecode'
      return shouldRun(policy, phase, parseOptions[ValidationModeOption])
        ? validate(value, ast)
        : undefined
    },
    {
      [LifecyclePolicyAnnotation]: policy,
      [ValidationCodeAnnotation]: options.code,
      [ValidationSeverityAnnotation]: options.severity ?? 'error',
      ...(options.expected !== undefined ? { expected: options.expected } : {}),
    }
  )
}

/**
 * Creates a native Schema filter that rejects external/persisted data while
 * reporting, rather than rejecting, live tree and draft intermediate states.
 */
export const diagnosticCheck = <A>(
  code: string,
  validate: (value: A, ast: SchemaAST.AST) => Schema.FilterOutput,
  options: Omit<LifecycleCheckOptions, 'code'> = {}
): SchemaAST.Filter<A> =>
  lifecycleCheck(validate, {
    ...options,
    code,
    policy: {
      externalDecode: 'reject',
      construction: 'reject',
      treeMutation: 'report',
      draft: 'report',
      persistence: 'reject',
      replication: 'report',
      ...options.policy,
    },
  })
