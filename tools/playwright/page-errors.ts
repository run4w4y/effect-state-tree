import type { ConsoleMessage, Page } from '@playwright/test'

export interface PageErrorGuardOptions {
  readonly ignoreConsole?: (message: ConsoleMessage) => boolean
  readonly ignorePageError?: (error: Error) => boolean
}

export interface PageErrorGuard {
  readonly errors: ReadonlyArray<string>
  readonly assertEmpty: () => void
  readonly stop: () => void
}

export const guardPageErrors = (
  page: Page,
  options: PageErrorGuardOptions = {}
): PageErrorGuard => {
  const errors: Array<string> = []

  const onConsole = (message: ConsoleMessage): void => {
    if (
      message.type() === 'error' &&
      options.ignoreConsole?.(message) !== true
    ) {
      errors.push(`console: ${message.text()}`)
    }
  }

  const onPageError = (error: Error): void => {
    if (options.ignorePageError?.(error) !== true) {
      errors.push(`pageerror: ${error.stack ?? error.message}`)
    }
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  return {
    errors,
    assertEmpty: () => {
      if (errors.length > 0) {
        throw new Error(`Unexpected browser errors:\n${errors.join('\n')}`)
      }
    },
    stop: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}
