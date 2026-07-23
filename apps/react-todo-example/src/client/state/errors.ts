import { Data } from 'effect'

export class TodoDraftInvalidError extends Data.TaggedError(
  'TodoDraftInvalidError'
)<{
  readonly issueCount: number
}> {}
