/* Ephemeral, local-only page interpretation input. Nothing is stored here. */
(() => {
  const MAX_TEXT = 6000
  const MAX_NODES = 900
  const excluded = 'script,style,noscript,template,input,textarea,select,option,button,[contenteditable="true"],[contenteditable=""],nav,header,footer,aside,[aria-hidden="true"]'

  function visible(element) {
    if (!(element instanceof Element) || element.matches(excluded) || element.closest(excluded)) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function clean(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
  }

  function extract() {
    const description = clean(document.querySelector('meta[name="description"]')?.content, 500)
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .filter(visible)
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
      if (!parent || !visible(parent)) continue
      const value = clean(node.nodeValue, 500)
      if (!value) continue
      chunks.push(value)
      length += value.length + 1
    }
    return {
      title: clean(document.title, 300),
      description,
      headings,
      pageText: clean(chunks.join(' '), MAX_TEXT),
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'tempo-read-page') return undefined
    return Promise.resolve(extract())
  })
})()
