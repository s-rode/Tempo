/*
 * Local-only companion. Visible context is sent ephemerally to Tempo and is
 * never retained by the extension or local server.
 */
const hostName = 'com.tempo.local.firefox'
let port = null
const states = new Map()

function key(tabId) {
  return String(tabId)
}

function connect() {
  if (port) return port
  try {
    port = browser.runtime.connectNative(hostName)
    port.onDisconnect.addListener(() => {
      port = null
    })
  } catch (_) {
    port = null
  }
  return port
}

async function send(state, reason) {
  if (!state || state.incognito || !state.url) return
  const current = states.get(key(state.id))
  if (!current || current.navigationGeneration !== state.navigationGeneration) return
  const native = connect()
  if (!native) return
  let pageContext = null
  try {
    pageContext = await browser.tabs.sendMessage(state.id, { type: 'tempo-read-page' })
  } catch (_) {
    // Restricted/PDF/loading pages intentionally fall back to title/hostname.
  }
  if (
    reason === 'content_change' &&
    !materiallyChangedPageContext(state.lastPageContext, pageContext)
  )
    return
  state.lastPageContext = pageContext
  if (reason === 'content_change') state.navigationGeneration += 1
  native.postMessage({
    type: 'navigation',
    tabId: state.id,
    windowId: state.windowId,
    documentId: state.documentId,
    navigationGeneration: state.navigationGeneration,
    title: state.title || '',
    url: state.url,
    private: false,
    reason,
    pageContext
  })
  if (reason === 'content_change') state.lastContentSentAt = Date.now()
}

function materiallyChangedPageContext(previous, next) {
  if (!previous) return true
  if (!next) return false
  const compact = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
  const stableMetadata = (value) =>
    JSON.stringify({
      title: compact(value.title),
      description: compact(value.description),
      headings: Array.isArray(value.headings) ? value.headings.map(compact) : []
    })
  if (stableMetadata(previous) !== stableMetadata(next)) return true
  const before = compact(previous.pageText)
  const after = compact(next.pageText)
  if (before === after) return false
  if (Math.abs(after.length - before.length) >= 80) return true
  const tokens = (value) =>
    new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).slice(0, 900))
  const oldTokens = tokens(before)
  let novelTokens = 0
  for (const token of tokens(after)) {
    if (!oldTokens.has(token)) novelTokens += 1
    if (novelTokens >= 8) return true
  }
  return false
}

function scheduleSend(state, reason, delay = 250) {
  if (!state || state.incognito || !state.url) return
  // webNavigation, tabs.onUpdated, and title changes commonly arrive in one
  // burst. One cancellable timer per tab/document ensures that burst performs
  // a single DOM read and native message.
  if (state.pendingSendTimer) clearTimeout(state.pendingSendTimer)
  const generation = state.navigationGeneration
  state.pendingSendTimer = setTimeout(() => {
    const current = states.get(key(state.id))
    if (!current || current.navigationGeneration !== generation) return
    current.pendingSendTimer = null
    void send(current, reason)
  }, delay)
}

async function rememberTab(tabId, reason, documentId, forceInvalidate = false) {
  const tab = await browser.tabs.get(tabId)
  if (tab.incognito) return
  const previous = states.get(key(tabId))
  // tabs.onActivated does not supply documentId. Resolve the stable identity
  // before comparing it, otherwise every app/tab activation looks like a new
  // document and prevents an exact navigation-cache hit.
  const effectiveDocumentId = documentId || previous?.documentId || `${tab.id}:initial`
  const navigationGeneration =
    !forceInvalidate &&
    previous &&
    previous.url === tab.url &&
    previous.documentId === effectiveDocumentId
      ? previous.navigationGeneration
      : (previous?.navigationGeneration || 0) + 1
  if (previous?.pendingSendTimer) clearTimeout(previous.pendingSendTimer)
  const state = { ...tab, documentId: effectiveDocumentId, navigationGeneration }
  states.set(key(tabId), state)
  scheduleSend(state, reason)
}

browser.tabs.onActivated.addListener(({ tabId }) => {
  void rememberTab(tabId, 'activation')
})
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.incognito) return
  const previous = states.get(key(tabId))
  if (changeInfo.url || changeInfo.status === 'loading') {
    void rememberTab(tabId, changeInfo.url ? 'navigation' : 'reload', undefined, true)
  } else if (changeInfo.title && previous) {
    previous.title = changeInfo.title
    previous.navigationGeneration += 1
    scheduleSend(previous, 'title_change')
  } else if (changeInfo.status === 'complete') {
    void rememberTab(tabId, 'navigation', previous?.documentId, false)
  }
})
browser.tabs.onRemoved.addListener((tabId) => {
  const state = states.get(key(tabId))
  if (state?.pendingSendTimer) clearTimeout(state.pendingSendTimer)
  states.delete(key(tabId))
})
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  void rememberTab(
    details.tabId,
    'navigation',
    details.documentId || `${details.tabId}:${details.timeStamp}`
  )
})

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'tempo-visible-page-changed' || !sender.tab?.id || sender.tab.incognito)
    return undefined
  const state = states.get(key(sender.tab.id))
  if (!state || !sender.tab.active) return undefined
  const elapsed = Date.now() - (state.lastContentSentAt || 0)
  const delay = Math.max(1200, 10000 - elapsed)
  scheduleSend(state, 'content_change', delay)
  return undefined
})

browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs[0]) void rememberTab(tabs[0].id, 'activation')
})
