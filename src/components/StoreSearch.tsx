'use client'

import { useEffect, useRef, useState } from 'react'
import { onStorePageLoaded, onStoreRequest } from '@/services/storePages'
import type { StoreRequest } from '@/services/storePages'
import type { EcwidPage } from './LightSpeedStore'

type StoreSearchProps = {
  /** False until the storefront script has loaded and its JS API is usable. */
  ready: boolean
  /** id of the store container — results are counted inside it and scrolled to. */
  resultsId: string
  /** Query from the hub URL (?q=), applied once the storefront can open a search. */
  initialQuery?: string
}

/*
 * Why search runs in two passes
 * -----------------------------
 * Ecwid indexes word stems ("clamshell" is stored as "clamshel") and offers
 * two search modes, each of which misses what the other finds. Measured on
 * the live store:
 *
 *   plain    "carbon"     →   0     "clamshell"  →  4
 *   prefix   "carbon*"    → 121     "clamshell*" →  0
 *
 * Plain search matches whole words (plurals and endings included); prefix
 * search (trailing *) matches the start of a word but is compared against the
 * stems. So: run the plain search, and only if it finds nothing, re-run it as
 * a prefix search.
 */

/**
 * Keeps ?q= in step with the store without adding a history entry.
 * Native replaceState (which Next syncs into useSearchParams) rather than
 * router.replace: the store pushes its own #!/ URL at the same moment, and
 * that cancels a pending router navigation. The store's hash is kept.
 */
function setUrlQuery(query: string) {
  const { pathname, hash } = window.location
  const search = query ? `?q=${encodeURIComponent(query)}` : ''
  window.history.replaceState(null, '', pathname + search + hash)
}

const same = (a = '', b = '') => a.trim().toLowerCase() === b.trim().toLowerCase()

/*
 * Reading the result count
 * ------------------------
 * OnPageLoaded carries no count, and on the embedded store the product tiles
 * can land before or after it fires (measured: either way, by a few hundred
 * ms). The store's breadcrumb states the count ("Search: 121 matches" /
 * "Search: no matches"), so: note the breadcrumb when a search starts, wait
 * until it changes — or until the page has had time to settle — then read it.
 * Waiting out the timeout is still correct when two searches in a row happen
 * to share a count.
 */
const COUNT_TIMEOUT_MS = 5000

const breadcrumbText = (root: Element | null) =>
  root?.querySelector('.breadcrumbs__link--last')?.textContent?.trim() ?? ''

function readCount(root: Element | null): number {
  const crumb = breadcrumbText(root)
  if (/no match/i.test(crumb)) return 0
  const matched = crumb.match(/(\d[\d,]*)\s+match/i)
  if (matched) return Number(matched[1].replace(/,/g, ''))
  // Breadcrumb markup is Ecwid-internal; fall back to what's drawn.
  if (root?.querySelector('.ec-search--empty')) return 0
  return root?.querySelectorAll('.grid-product').length ?? 0
}

function waitForCount(root: Element | null, before: string): Promise<number> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const now = breadcrumbText(root)
      if ((now && now !== before) || Date.now() - started > COUNT_TIMEOUT_MS) {
        resolve(readCount(root))
      } else {
        window.setTimeout(tick, 100)
      }
    }
    tick()
  })
}

/**
 * Drives the embedded storefront for the site's own search box and category
 * bar, through Ecwid's JS API. It has no search field of its own: the box
 * lives in the header (HeaderSearch) and sends its requests here through
 * services/storePages.ts. A ?q= in the page URL is opened as a search too.
 * All this renders is a short note when a search had to fall back or found
 * nothing.
 *
 * Built by hand (not Ecwid's search widget) because the dynamic embed only
 * supports the main ProductBrowser widget.
 * Docs: https://docs.ecwid.com/storefronts/open-page-on-the-storefront/open-search-page-with-params
 */
export function StoreSearch({ ready, resultsId, initialQuery = '' }: StoreSearchProps) {
  const [note, setNote] = useState('')
  /** Plain search waiting to be checked for zero results. */
  const pendingPlain = useRef<string | null>(null)
  /** Prefix search waiting to be checked, so a double miss can say so. */
  const pendingPrefix = useRef<string | null>(null)
  /** Breadcrumb at the moment the pending search started. */
  const crumbBefore = useRef('')
  /** Bumped on every new search so a slow count for an old one is ignored. */
  const searchRun = useRef(0)
  /** Last keyword handed to Ecwid, so a URL update doesn't search twice. */
  const lastOpened = useRef<string | null>(null)
  /** Retries while the store isn't ready to open a page yet (capped). */
  const retryTimer = useRef(0)
  const retries = useRef(0)
  /** The first ?q= of a page load is checked against the store's own route once. */
  const firstQueryRun = useRef(true)

  useEffect(() => () => window.clearTimeout(retryTimer.current), [])

  useEffect(() => {
    if (!ready) return

    const root = () => document.getElementById(resultsId)

    return onStorePageLoaded((page: EcwidPage) => {
      if (page.type !== 'SEARCH') {
        // The visitor left the search (a product, category, the cart…). Drop
        // ?q= so a reload or shared link shows this page rather than the old
        // search, and let the same search run again. A search that is still
        // opening (pending) passes through the store's front page first.
        if (!pendingPlain.current && !pendingPrefix.current && lastOpened.current !== null) {
          lastOpened.current = null
          setNote('')
          if (new URLSearchParams(window.location.search).has('q')) setUrlQuery('')
        }
        return
      }
      const run = searchRun.current

      if (pendingPlain.current && same(page.keywords, pendingPlain.current)) {
        const query = pendingPlain.current
        pendingPlain.current = null
        void waitForCount(root(), crumbBefore.current).then((found) => {
          if (run !== searchRun.current || found > 0) return
          crumbBefore.current = breadcrumbText(root())
          pendingPrefix.current = `${query}*`
          setNote(`No exact matches for “${query}” — showing products that start with it.`)
          window.Ecwid?.openPage?.('search', { keyword: `${query}*` })
        })
        return
      }

      if (pendingPrefix.current && same(page.keywords, pendingPrefix.current)) {
        const query = pendingPrefix.current.slice(0, -1)
        pendingPrefix.current = null
        void waitForCount(root(), crumbBefore.current).then((found) => {
          if (run !== searchRun.current || found > 0) return
          setNote(`No products match “${query}”. Try a shorter word, a size like 8.5x11, or a SKU — or call (754) 701-1797.`)
        })
      }
    })
  }, [ready, resultsId])

  const showResults = () => {
    document.getElementById(resultsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Forget any search in progress: the store is about to show something else. */
  const dropSearch = () => {
    lastOpened.current = null
    searchRun.current += 1
    pendingPlain.current = null
    pendingPrefix.current = null
    setNote('')
    // A product or category isn't a search: don't let ?q= reopen one on reload.
    setUrlQuery('')
  }

  /** The store wasn't ready to open a page yet: try again shortly, for up to ~10s. */
  const retryLater = (raw: string, updateUrl: boolean) => {
    lastOpened.current = null
    if (retries.current >= 25) return
    retries.current += 1
    window.clearTimeout(retryTimer.current)
    retryTimer.current = window.setTimeout(() => openQueryRef.current(raw, updateUrl), 400)
  }

  const openQuery = (raw: string, updateUrl: boolean) => {
    if (!ready) return
    const query = raw.trim().replace(/\s+/g, ' ')
    if (lastOpened.current === query) return
    lastOpened.current = query

    setNote('')
    searchRun.current += 1
    pendingPrefix.current = null
    crumbBefore.current = breadcrumbText(document.getElementById(resultsId))

    const openStorePage = (page: string, params?: Record<string, unknown>) => {
      try {
        window.Ecwid?.openPage?.(page, params)
        return true
      } catch {
        return false
      }
    }

    if (query) {
      // A query the visitor already ended with * is a deliberate prefix search.
      pendingPlain.current = query.endsWith('*') ? null : query
      if (!openStorePage('search', { keyword: query })) {
        pendingPlain.current = null
        retryLater(raw, updateUrl)
        return
      }
      if (updateUrl) setUrlQuery(query)
    } else {
      pendingPlain.current = null
      if (!openStorePage('category')) {
        retryLater(raw, updateUrl)
        return
      }
      if (updateUrl) setUrlQuery('')
    }
    retries.current = 0
    showResults()
  }

  const openQueryRef = useRef(openQuery)

  /** A request from the header search or the category bar. */
  const handleRequest = (request: StoreRequest) => {
    // What the visitor just asked for outranks whatever the page URL arrived with.
    firstQueryRun.current = false

    if (request.kind === 'search') {
      // Pressing Search always runs it, even for the same words as last time.
      lastOpened.current = null
      if (ready) openQuery(request.query, true)
      // Still loading: leave it in ?q=, which is opened once the store is ready.
      else setUrlQuery(request.query.trim().replace(/\s+/g, ' '))
      return
    }

    dropSearch()
    try {
      if (!ready || !window.Ecwid?.openPage) throw new Error('store not ready')
      if (request.kind === 'product') window.Ecwid.openPage('product', { id: request.id })
      else if (request.id) window.Ecwid.openPage('category', { id: request.id })
      else window.Ecwid.openPage('category')
    } catch {
      // The store reads its route from the URL when it finishes loading.
      window.location.hash = request.route || '#!/'
    }
    showResults()
  }

  const handleRequestRef = useRef(handleRequest)
  useEffect(() => {
    openQueryRef.current = openQuery
    handleRequestRef.current = handleRequest
  })

  useEffect(() => onStoreRequest((request) => handleRequestRef.current(request)), [])

  // Apply a query that arrived with the page, after Ecwid's API exists.
  // The timeout lets StrictMode cancel the first pass before it touches the store.
  useEffect(() => {
    if (!initialQuery || !ready) return
    if (firstQueryRun.current) {
      firstQueryRun.current = false
      // An older shared link like ?q=napkin#!/…/p/123 is a product page, not a
      // search: show the product and drop the stale ?q=.
      if (/^#!\/(?!~\/search)/.test(window.location.hash)) {
        setUrlQuery('')
        return
      }
    }
    const timer = window.setTimeout(() => openQueryRef.current(initialQuery, false), 0)
    return () => window.clearTimeout(timer)
  }, [ready, initialQuery])

  return note ? (
    <p role="status" className="text-sm text-slate-500">
      {note}
    </p>
  ) : null
}
