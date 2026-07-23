import {
  guardPageErrors,
  type PageErrorGuard,
} from '@effect-state-tree/test-infrastructure'
import {
  type APIRequestContext,
  test as base,
  expect,
  type Page,
} from '@playwright/test'

const apiUrl = 'http://127.0.0.1:4312'
const expectedConflictPages = new WeakSet<Page>()

const guardTodoPageErrors = (page: Page): PageErrorGuard =>
  guardPageErrors(page, {
    ignoreConsole: (message) =>
      (message.text().includes('Failed to load resource') &&
        message.location().url.endsWith('/favicon.ico')) ||
      (expectedConflictPages.has(page) &&
        message.text().includes('409 (Conflict)')),
  })

interface TodoJson {
  readonly id: string
  readonly title: string
  readonly notes: string
  readonly priority: 'low' | 'normal' | 'high'
  readonly completed: boolean
}

interface TodoDocumentJson {
  readonly version: number
  readonly todos: ReadonlyArray<TodoJson>
}

interface PageErrorFixture {
  readonly pageErrorGuard: PageErrorGuard
}

const makeGate = () => {
  let open: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

const test = base.extend<PageErrorFixture>({
  pageErrorGuard: [
    async ({ page }, use) => {
      const guard = guardTodoPageErrors(page)
      await use(guard)
      guard.assertEmpty()
      guard.stop()
    },
    { auto: true },
  ],
})

const documentUrl = (documentId: string): string =>
  `/?document=${encodeURIComponent(documentId)}`

const apiDocumentUrl = (documentId: string): string =>
  `${apiUrl}/api/todo-documents/${encodeURIComponent(documentId)}`

const openDocument = async (page: Page, documentId: string): Promise<void> => {
  await page.goto(documentUrl(documentId))
  await expect(
    page.getByRole('heading', { name: /Draft first\. Save once\./ })
  ).toBeVisible()
  await expect(page.getByText('original v1 / draft v1')).toBeVisible()
}

const getDocument = async (
  request: APIRequestContext,
  documentId: string
): Promise<TodoDocumentJson> => {
  const response = await request.get(apiDocumentUrl(documentId))
  expect(response.ok()).toBe(true)
  return response.json()
}

const saveDocument = async (
  request: APIRequestContext,
  documentId: string,
  document: TodoDocumentJson
): Promise<TodoDocumentJson> => {
  const response = await request.put(apiDocumentUrl(documentId), {
    data: {
      expectedVersion: document.version,
      todos: document.todos,
    },
  })
  expect(response.ok()).toBe(true)
  return response.json()
}

const addTodo = async (page: Page, title: string): Promise<void> => {
  await page.getByLabel('New todo title').fill(title)
  await page.getByRole('button', { name: 'Add todo' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

test('loads the initial document from the typed HttpApi backend', async ({
  page,
}) => {
  await openDocument(page, 'e2e-initial-load')

  await expect(page.getByRole('list', { name: 'Todos' })).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: 'Move updates into context-backed actions',
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Edit locally, then save once' })
  ).toBeVisible()
  await expect(page.getByText('server synchronized')).toBeVisible()
})

test('keeps edits local and applies undo and redo to the draft', async ({
  page,
  request,
}) => {
  const documentId = 'e2e-local-history'
  await openDocument(page, documentId)
  await addTodo(page, 'Local history item')

  await expect(page.getByText('local changes pending')).toBeVisible()
  await expect(page.getByText('1 undo / 0 redo')).toBeVisible()

  const beforeSave = await getDocument(request, documentId)
  expect(
    beforeSave.todos.some((todo) => todo.title === 'Local history item')
  ).toBe(false)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.getByRole('heading', { name: 'Local history item' })
  ).toHaveCount(0)
  await expect(page.getByText('0 undo / 1 redo')).toBeVisible()

  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(
    page.getByRole('heading', { name: 'Local history item' })
  ).toBeVisible()
  await expect(page.getByText('1 undo / 0 redo')).toBeVisible()
})

test('saves once and reconciles the authoritative server document', async ({
  page,
  request,
}) => {
  const documentId = 'e2e-save-reconcile'
  await openDocument(page, documentId)

  await page.getByRole('button', { name: 'Edit' }).first().click()
  const editor = page.getByRole('complementary', { name: 'Todo editor' })
  const notes = editor.getByLabel('Notes')
  await notes.fill('   normalized by the server   ')
  await expect(page.getByText('local changes pending')).toBeVisible()

  await page.getByRole('button', { name: 'Save to server' }).click()

  await expect(
    page.getByText('Saved and reconciled server version 2.')
  ).toBeVisible()
  await expect(page.getByText('original v2 / draft v2')).toBeVisible()
  await expect(page.getByText('server synchronized')).toBeVisible()
  await expect(notes).toHaveValue('normalized by the server')
  await expect(page.getByText('0 undo / 0 redo')).toBeVisible()

  const saved = await getDocument(request, documentId)
  expect(saved.version).toBe(2)
  expect(saved.todos[0]?.notes).toBe('normalized by the server')
})

test('preserves edits made while a save request is in flight', async ({
  page,
  request,
}) => {
  const documentId = 'e2e-save-in-flight'
  await openDocument(page, documentId)
  await page.getByRole('button', { name: 'Edit' }).first().click()
  const editor = page.getByRole('complementary', { name: 'Todo editor' })
  const notes = editor.getByLabel('Notes')
  await notes.fill('submitted before the delayed response')

  const requestStarted = makeGate()
  const releaseRequest = makeGate()
  await page.route(apiDocumentUrl(documentId), async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    requestStarted.open()
    await releaseRequest.wait
    await route.continue()
  })

  await page.getByRole('button', { name: 'Save to server' }).click()
  await requestStarted.wait
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible()

  await notes.fill('newer edit that must remain local')
  await expect(notes).toHaveValue('newer edit that must remain local')
  releaseRequest.open()

  await expect(
    page.getByText(
      'Saved server version 2; newer local changes remain in the draft.'
    )
  ).toBeVisible()
  await expect(page.getByText('original v2 / draft v1')).toBeVisible()
  await expect(page.getByText('local changes pending')).toBeVisible()
  await expect(notes).toHaveValue('newer edit that must remain local')

  const saved = await getDocument(request, documentId)
  expect(saved.version).toBe(2)
  expect(saved.todos[0]?.notes).toBe('submitted before the delayed response')
})

test('does not overwrite an edit that starts while reload is in flight', async ({
  page,
}) => {
  const documentId = 'e2e-reload-in-flight'
  await openDocument(page, documentId)
  await page.getByRole('button', { name: 'Edit' }).first().click()
  const editor = page.getByRole('complementary', { name: 'Todo editor' })
  const notes = editor.getByLabel('Notes')

  const requestStarted = makeGate()
  const releaseRequest = makeGate()
  await page.route(apiDocumentUrl(documentId), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    requestStarted.open()
    await releaseRequest.wait
    await route.continue()
  })

  await page.getByRole('button', { name: 'Reload server' }).click()
  await requestStarted.wait
  await expect(page.getByRole('button', { name: 'Reloading…' })).toBeVisible()

  await notes.fill('local edit during reload')
  await expect(notes).toHaveValue('local edit during reload')
  releaseRequest.open()

  await expect(
    page.getByText(
      'Reloaded server version 1; newer local changes remain in the draft.'
    )
  ).toBeVisible()
  await expect(notes).toHaveValue('local edit during reload')
  await expect(page.getByText('original v1 / draft v1')).toBeVisible()
  await expect(page.getByText('local changes pending')).toBeVisible()
})

test('preserves the local draft and history after a version conflict', async ({
  page,
  request,
}) => {
  const documentId = 'e2e-version-conflict'
  await openDocument(page, documentId)
  await addTodo(page, 'Unsaved conflict item')

  const current = await getDocument(request, documentId)
  const advanced = await saveDocument(request, documentId, {
    ...current,
    todos: [
      ...current.todos,
      {
        id: 'external-change',
        title: 'External server change',
        notes: '',
        priority: 'normal',
        completed: false,
      },
    ],
  })
  expect(advanced.version).toBe(2)

  expectedConflictPages.add(page)
  await page.getByRole('button', { name: 'Save to server' }).click()

  await expect(page.getByText(/TodoConflict/)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Unsaved conflict item' })
  ).toBeVisible()
  await expect(page.getByText('original v2 / draft v1')).toBeVisible()
  await expect(page.getByText('local changes pending')).toBeVisible()
  await expect(page.getByText('1 undo / 0 redo')).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.getByRole('heading', { name: 'Unsaved conflict item' })
  ).toHaveCount(0)
  await expect(page.getByText('0 undo / 1 redo')).toBeVisible()

  const serverDocument = await getDocument(request, documentId)
  expect(
    serverDocument.todos.some((todo) => todo.title === 'External server change')
  ).toBe(true)
  expect(
    serverDocument.todos.some((todo) => todo.title === 'Unsaved conflict item')
  ).toBe(false)
})

test('reports a Schema-invalid draft and blocks saving it', async ({
  page,
  request,
}) => {
  const documentId = 'e2e-schema-invalid'
  await openDocument(page, documentId)

  await page.getByRole('button', { name: 'Edit' }).first().click()
  const editor = page.getByRole('complementary', { name: 'Todo editor' })
  await editor.getByLabel('Title').fill('')

  await expect(
    page.getByText('1 Schema diagnostic must be fixed before saving.')
  ).toBeVisible()
  await expect(editor.getByText('Invalid data ""')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save to server' })
  ).toBeDisabled()
  await expect(page.getByText('local changes pending')).toBeVisible()

  const serverDocument = await getDocument(request, documentId)
  expect(serverDocument.version).toBe(1)
  expect(serverDocument.todos[0]?.title).toBe(
    'Move updates into context-backed actions'
  )
})

test('isolates documents selected through the query string', async ({
  browser,
}) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const firstPage = await firstContext.newPage()
  const secondPage = await secondContext.newPage()
  const firstGuard = guardTodoPageErrors(firstPage)
  const secondGuard = guardTodoPageErrors(secondPage)

  try {
    await Promise.all([
      openDocument(firstPage, 'e2e-isolated-first'),
      openDocument(secondPage, 'e2e-isolated-second'),
    ])

    await addTodo(firstPage, 'Only in the first document')
    await firstPage.getByRole('button', { name: 'Save to server' }).click()
    await expect(firstPage.getByText('original v2 / draft v2')).toBeVisible()

    await expect(
      secondPage.getByRole('heading', { name: 'Only in the first document' })
    ).toHaveCount(0)
    await expect(secondPage.getByText('original v1 / draft v1')).toBeVisible()
    await expect(secondPage.getByText('server synchronized')).toBeVisible()

    await secondPage.reload()
    await expect(
      secondPage.getByRole('heading', { name: /Draft first\. Save once\./ })
    ).toBeVisible()
    await expect(
      secondPage.getByRole('heading', { name: 'Only in the first document' })
    ).toHaveCount(0)
  } finally {
    firstGuard.assertEmpty()
    secondGuard.assertEmpty()
    firstGuard.stop()
    secondGuard.stop()
    await firstContext.close()
    await secondContext.close()
  }
})
