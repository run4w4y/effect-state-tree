# @effect-state-tree/test-infrastructure

`@effect-state-tree/test-infrastructure` is a private workspace package shared
by the repository's browser examples. It is not a public effect-state-tree
package, is not included in development snapshots, and is not intended to be
installed by consumer applications.

The package currently exports one Playwright helper that records unexpected
browser console errors and uncaught page errors.

## Guard a Playwright page

```ts
import { test } from '@playwright/test'
import { guardPageErrors } from '@effect-state-tree/test-infrastructure'

test('the application has no unexpected browser errors', async ({ page }) => {
  const guard = guardPageErrors(page)

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add' }).click()
    guard.assertEmpty()
  } finally {
    guard.stop()
  }
})
```

`guardPageErrors` starts listening immediately. The returned guard exposes the
collected `errors`, an `assertEmpty()` assertion, and `stop()` for listener
cleanup.

Expected errors can be filtered deliberately:

```ts
const guard = guardPageErrors(page, {
  ignoreConsole: (message) =>
    message.text().includes('expected development diagnostic'),
  ignorePageError: (error) =>
    error.message.includes('expected test failure'),
})
```

Keep filters narrow so new application failures still fail the test.

## Used by

- [React todo browser tests](https://github.com/run4w4y/effect-state-tree/blob/main/apps/react-todo-example/e2e/todo.spec.ts)
- [React Loro collaboration browser
  tests](https://github.com/run4w4y/effect-state-tree/blob/main/apps/react-loro-collaboration-example/e2e/collaboration.spec.ts)
