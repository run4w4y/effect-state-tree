import {
  guardPageErrors,
  type PageErrorGuard,
} from '@effect-state-tree/test-infrastructure'
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from '@playwright/test'

const frontendUrl = 'http://127.0.0.1:4314'
const expectedOfflinePages = new WeakSet<Page>()

interface BrowserPeer {
  readonly context: BrowserContext
  readonly guard: PageErrorGuard
  readonly page: Page
  readonly setTransportOnline: (online: boolean) => Promise<void>
}

const connection = (page: Page) => page.getByTestId('connection-state')

const cardInputs = (page: Page) =>
  page.getByTestId('collaboration-board').locator('ol').first().locator('input')

const notes = (page: Page) =>
  page.getByTestId('collaboration-board').locator('output')

const makePeerUrl = (roomId: string, peerId: string): string => {
  const url = new URL(frontendUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('peer', peerId)
  return url.toString()
}

const guardPeerErrors = (page: Page): PageErrorGuard =>
  guardPageErrors(page, {
    ignoreConsole: (message) => {
      const text = message.text()
      return (
        (text.includes('Failed to load resource') &&
          message.location().url.endsWith('/favicon.ico')) ||
        (expectedOfflinePages.has(page) &&
          (text.includes('WebSocket') ||
            text.includes('ERR_INTERNET_DISCONNECTED')))
      )
    },
  })

const openPeer = async (
  browser: Browser,
  roomId: string,
  peerId: string
): Promise<BrowserPeer> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const guard = guardPeerErrors(page)
  let online = true
  let activeSocket: WebSocketRoute | undefined
  await page.routeWebSocket(/\/collaboration(?:\?|$)/, async (socket) => {
    activeSocket = socket
    if (!online) {
      await socket.close({ code: 1013, reason: 'E2E peer offline' })
      return
    }
    socket.connectToServer()
  })
  await page.goto(makePeerUrl(roomId, peerId))
  await expect(page.getByTestId('collaboration-board')).toBeVisible()
  await expect(connection(page)).toHaveAttribute(
    'data-connection-state',
    'Connected'
  )
  return {
    context,
    guard,
    page,
    setTransportOnline: async (nextOnline) => {
      online = nextOnline
      if (!nextOnline && activeSocket !== undefined) {
        await activeSocket.close({ code: 1013, reason: 'E2E peer offline' })
      }
    },
  }
}

const closePeer = async (peer: BrowserPeer): Promise<void> => {
  peer.guard.assertEmpty()
  peer.guard.stop()
  await peer.context.close()
}

const expectPeerCount = async (
  peers: ReadonlyArray<BrowserPeer>,
  count: number
): Promise<void> => {
  await Promise.all(
    peers.map((peer) =>
      expect(connection(peer.page)).toHaveAttribute(
        'data-peer-count',
        String(count)
      )
    )
  )
}

const expectCardTitles = async (
  page: Page,
  expected: ReadonlyArray<string>
): Promise<void> => {
  await expect
    .poll(() =>
      cardInputs(page).evaluateAll((elements) =>
        elements.map((element) =>
          element instanceof HTMLInputElement ? element.value : ''
        )
      )
    )
    .toEqual(expected)
}

const expectAllCardTitles = async (
  peers: ReadonlyArray<BrowserPeer>,
  expected: ReadonlyArray<string>
): Promise<void> => {
  await Promise.all(peers.map((peer) => expectCardTitles(peer.page, expected)))
}

const expectAllNotesContain = async (
  peers: ReadonlyArray<BrowserPeer>,
  expected: string
): Promise<void> => {
  await Promise.all(
    peers.map((peer) => expect(notes(peer.page)).toContainText(expected))
  )
}

const addCard = async (page: Page, title: string): Promise<void> => {
  await page.getByLabel('New card title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}

const appendText = async (page: Page, text: string): Promise<void> => {
  await page.getByLabel('Text to append').fill(text)
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
}

test('converges arbitrary peers, preserves native intent, and isolates local undo', async ({
  browser,
}) => {
  const roomId = `room-${crypto.randomUUID()}`
  const [alice, bob, carol] = await Promise.all([
    openPeer(browser, roomId, 'alice'),
    openPeer(browser, roomId, 'bob'),
    openPeer(browser, roomId, 'carol'),
  ] as const)
  const peers = [alice, bob, carol]

  try {
    await expectPeerCount(peers, 3)

    await Promise.all([
      alice.page
        .getByLabel('Rename Shape the tree kernel')
        .fill('Kernel shaped by Alice'),
      bob.page.getByLabel('Move Sync peer intent left').click(),
      appendText(carol.page, 'Concurrent notes from Carol.'),
    ])

    const concurrentTitles = [
      'Kernel shaped by Alice',
      'Sync peer intent',
      'Wire Effect actions',
    ]
    await expectAllCardTitles(peers, concurrentTitles)
    await expectAllNotesContain(peers, 'Concurrent notes from Carol.')
    await expect(
      bob.page
        .getByTestId('commit-feed')
        .getByText('ArrayMove', { exact: false })
        .first()
    ).toBeVisible()
    await expect(
      carol.page
        .getByTestId('commit-feed')
        .getByText('TextInsert', { exact: false })
        .first()
    ).toBeVisible()

    await addCard(alice.page, 'Only Alice should undo')
    await expectAllCardTitles(peers, [
      ...concurrentTitles,
      'Only Alice should undo',
    ])
    await addCard(bob.page, 'Bob remains after Alice undo')
    await expectAllCardTitles(peers, [
      ...concurrentTitles,
      'Only Alice should undo',
      'Bob remains after Alice undo',
    ])

    await alice.page
      .getByRole('button', { name: 'Undo mine', exact: true })
      .click()
    const afterUndo = [...concurrentTitles, 'Bob remains after Alice undo']
    await expectAllCardTitles(peers, afterUndo)

    const dave = await openPeer(browser, roomId, 'dave')
    peers.push(dave)
    await expectPeerCount(peers, 4)
    await expectCardTitles(dave.page, afterUndo)
    await expect(notes(dave.page)).toContainText('Concurrent notes from Carol.')
  } finally {
    await Promise.all(peers.map(closePeer))
  }
})

test('merges an offline peer on reconnect and keeps rooms isolated', async ({
  browser,
}) => {
  const roomId = `offline-${crypto.randomUUID()}`
  const [alice, bob, carol] = await Promise.all([
    openPeer(browser, roomId, 'alice'),
    openPeer(browser, roomId, 'bob'),
    openPeer(browser, roomId, 'carol'),
  ] as const)
  const sharedPeers = [alice, bob, carol]
  let isolated: BrowserPeer | undefined

  try {
    await expectPeerCount(sharedPeers, 3)
    expectedOfflinePages.add(carol.page)
    await carol.setTransportOnline(false)
    await expect(connection(carol.page)).not.toHaveAttribute(
      'data-connection-state',
      'Connected'
    )
    await expectPeerCount([alice, bob], 2)

    await Promise.all([
      addCard(carol.page, 'Created while offline'),
      appendText(bob.page, 'Online while Carol was offline.'),
    ])
    await expectCardTitles(carol.page, [
      'Shape the tree kernel',
      'Wire Effect actions',
      'Sync peer intent',
      'Created while offline',
    ])
    await expect(notes(alice.page)).toContainText(
      'Online while Carol was offline.'
    )
    await expect(
      alice.page.getByLabel('Rename Created while offline')
    ).toHaveCount(0)

    await carol.setTransportOnline(true)
    await expect(connection(carol.page)).toHaveAttribute(
      'data-connection-state',
      'Connected'
    )
    await expectPeerCount(sharedPeers, 3)
    await Promise.all(
      sharedPeers.map(async (peer) => {
        await expect(
          peer.page.getByLabel('Rename Created while offline')
        ).toBeVisible()
        await expect(notes(peer.page)).toContainText(
          'Online while Carol was offline.'
        )
      })
    )

    isolated = await openPeer(browser, `isolated-${crypto.randomUUID()}`, 'eve')
    await expectPeerCount([isolated], 1)
    await addCard(isolated.page, 'Private room card')
    await expect(
      isolated.page.getByLabel('Rename Private room card')
    ).toBeVisible()
    await Promise.all(
      sharedPeers.map((peer) =>
        expect(peer.page.getByLabel('Rename Private room card')).toHaveCount(0)
      )
    )
  } finally {
    await Promise.all([
      ...sharedPeers.map(closePeer),
      ...(isolated === undefined ? [] : [closePeer(isolated)]),
    ])
  }
})
