/*
 * Local-only companion. Visible context is sent ephemerally to Tempo and is
 * never retained by the extension or local server.
 */
const hostName = 'com.tempo.local.firefox'
let port = null
const states = new Map()

function key(tabId) { return String(tabId) }

function connect() {
  if (port) return port
  try {
    port = browser.runtime.connectNative(hostName)
    port.onDisconnect.addListener(() => { port = null })
  } catch (_) {
    port = null
  }
  return port
}

async function send(state, reason) {
  if (!state || state.incognito || !state.url) return
  // Let the active document settle briefly; this also coalesces the common
  // navigation/complete burst without introducing recurring page polling.
  await new Promise((resolve) => setTimeout(resolve, 250))
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
}

async function rememberTab(tabId, reason, documentId, forceInvalidate = false) {
  const tab = await browser.tabs.get(tabId)
  if (tab.incognito) return
  const previous = states.get(key(tabId))
  // tabs.onActivated does not supply documentId. Resolve the stable identity
  // before comparing it, otherwise every app/tab activation looks like a new
  // document and prevents an exact navigation-cache hit.
  const effectiveDocumentId = documentId || previous?.documentId || `${tab.id}:initial`
  const navigationGeneration = !forceInvalidate && previous && previous.url === tab.url && previous.documentId === effectiveDocumentId
    ? previous.navigationGeneration
    : (previous?.navigationGeneration || 0) + 1
  const state = { ...tab, documentId: effectiveDocumentId, navigationGeneration }
  states.set(key(tabId), state)
  send(state, reason)
}

browser.tabs.onActivated.addListener(({ tabId }) => { void rememberTab(tabId, 'activation') })
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.incognito) return
  const previous = states.get(key(tabId))
  if (changeInfo.url || changeInfo.status === 'loading') {
    void rememberTab(tabId, changeInfo.url ? 'navigation' : 'reload', undefined, true)
  } else if (changeInfo.title && previous) {
    previous.title = changeInfo.title
    previous.navigationGeneration += 1
    send(previous, 'title_change')
  } else if (changeInfo.status === 'complete') {
    void rememberTab(tabId, 'navigation', previous?.documentId, false)
  }
})
browser.tabs.onRemoved.addListener((tabId) => states.delete(key(tabId)))
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  void rememberTab(details.tabId, 'navigation', details.documentId || `${details.tabId}:${details.timeStamp}`)
})

browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs[0]) void rememberTab(tabs[0].id, 'activation')
})
