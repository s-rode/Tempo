/* Ephemeral, local-only page interpretation input. Nothing is stored here. */
;(() => {
  const MAX_TEXT = 6000
  const MAX_NODES = 900
  const excluded =
    'script,style,noscript,template,input,textarea,select,option,button,[contenteditable="true"],[contenteditable=""],nav,header,footer,aside,[aria-hidden="true"]'

  // True when the element or any ancestor matches `excluded`. Equivalent to
  // `matches(excluded) || closest(excluded)`, but each element is matched once
  // per cache instead of once per descendant walking up the whole ancestor chain.
  function isExcluded(element, cache) {
    const chain = []
    let result = false
    for (let node = element; node; node = node.parentElement) {
      const known = cache.get(node)
      if (known !== undefined) {
        result = known
        break
      }
      chain.push(node)
      if (node.matches(excluded)) {
        result = true
        break
      }
    }
    for (const node of chain) cache.set(node, result)
    return result
  }

  function visible(element, cache, excludedCache) {
    if (!(element instanceof Element)) return false
    const cached = cache.get(element)
    if (cached !== undefined) return cached
    if (isExcluded(element, excludedCache)) {
      cache.set(element, false)
      return false
    }
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      cache.set(element, false)
      return false
    }
    const rect = element.getBoundingClientRect()
    const result = rect.width > 0 && rect.height > 0
    cache.set(element, result)
    return result
  }

  function clean(value, limit) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
  }

  function extract() {
    const visibilityCache = new WeakMap()
    const excludedCache = new WeakMap()
    const description = clean(document.querySelector('meta[name="description"]')?.content, 500)
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .filter((element) => visible(element, visibilityCache, excludedCache))
      .slice(0, 16)
      .map((node) => clean(node.textContent, 180))
      .filter(Boolean)
    const root = document.querySelector('main,article,[role="main"]') || document.body
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const chunks = []
    let length = 0
    let seen = 0
    while (length < MAX_TEXT && seen < MAX_NODES) {
      const node = walker.nextNode()
      if (!node) break
      seen += 1
      const parent = node.parentElement
      if (!parent || !visible(parent, visibilityCache, excludedCache)) continue
      const value = clean(node.nodeValue, 500)
      if (!value) continue
      chunks.push(value)
      length += value.length + 1
    }
    return {
      title: clean(document.title, 300),
      description,
      headings,
      pageText: clean(chunks.join(' '), MAX_TEXT)
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'tempo-read-page') return undefined
    return Promise.resolve(extract())
  })

  // Dynamic pages often update their visible result without navigating or
  // changing the title. Observe only non-editable visible-page mutations and
  // send a cheap invalidation signal after the page settles. The background
  // script performs the bounded extraction and fingerprint deduplication.
  let settledTimer = null
  let firstMutationAt = 0
  function announceSettledChange() {
    settledTimer = null
    firstMutationAt = 0
    void browser.runtime.sendMessage({ type: 'tempo-visible-page-changed' }).catch(() => {})
  }
  function scheduleSettledChange() {
    const now = Date.now()
    if (!firstMutationAt) firstMutationAt = now
    if (settledTimer) clearTimeout(settledTimer)
    const elapsed = now - firstMutationAt
    settledTimer = setTimeout(announceSettledChange, elapsed >= 8000 ? 100 : 1200)
  }
  const observer = new MutationObserver((mutations) => {
    // Streaming pages append many nodes under one container; match it once per batch.
    const excludedCache = new WeakMap()
    const relevant = mutations.some((mutation) => {
      const target =
        mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
      return target && !isExcluded(target, excludedCache)
    })
    if (relevant && document.visibilityState === 'visible') scheduleSettledChange()
  })
  // Only the foreground tab matters. Background tabs (feeds, chats, dashboards)
  // would otherwise run the observer callback for every DOM change forever.
  const beginObservation = () => {
    if (!document.body || document.visibilityState !== 'visible') return
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  }
  const endObservation = () => {
    observer.disconnect()
    if (settledTimer) clearTimeout(settledTimer)
    settledTimer = null
    firstMutationAt = 0
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beginObservation()
    else endObservation()
  })
  if (document.body) beginObservation()
  else document.addEventListener('DOMContentLoaded', beginObservation, { once: true })
})()
