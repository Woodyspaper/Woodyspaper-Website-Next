'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MIN_QUERY_LENGTH, searchProducts, suggestionsEnabled } from '@/services/productSearch'
import type { ProductSuggestion, SuggestionResults } from '@/services/productSearch'
import { onStorePageLoaded } from '@/services/storePages'
import type { EcwidPage } from './LightSpeedStore'
import { SearchSuggestions, optionId } from './SearchSuggestions'

type StoreSearchProps = {
  /** False until the storefront script has loaded and its JS API is usable. */
  ready: boolean
  /** id of the store container — results are counted inside it and scrolled to. */
  resultsId: string
  /** Query from the hub URL, applied once the storefront can open a search. */
  initialQuery?: string
  /**
   * Run searches on this page instead (e.g. "/inventory"): submitting goes
   * there with ?q= rather than searching the store in place.
   */
  searchPath?: string
  /** The store failed to load: say so on the button instead of "Loading store…". */
  unavailable?: boolean
}

type ProductSearchFormProps = {
  id: string
  keyword: string
  onKeywordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClear: () => void
  /** A product chosen from the suggestions while typing. */
  onPickProduct: (product: ProductSuggestion) => void
  buttonLabel: string
  buttonDisabled?: boolean
  note?: string
}

/**
 * The site-styled search field above the store. While the visitor types, it
 * suggests matching products (see services/productSearch.ts); Enter or
 * "See all" still runs the full store search.
 */
function ProductSearchForm({
  id,
  keyword,
  onKeywordChange,
  onSubmit,
  onClear,
  onPickProduct,
  buttonLabel,
  buttonDisabled = false,
  note = '',
}: ProductSearchFormProps) {
  const listId = `${id}-suggestions`
  const formRef = useRef<HTMLFormElement>(null)
  /** Suggestions only follow the visitor's own typing, not a query filled in from the URL. */
  const [typed, setTyped] = useState(false)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SuggestionResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  /** The words the current `results` were found for. */
  const [resultsFor, setResultsFor] = useState('')

  const query = keyword.trim()
  const canSuggest = suggestionsEnabled && typed && query.length >= MIN_QUERY_LENGTH
  const items = results?.items ?? []
  const showList = open && canSuggest && (results !== null || loading || failed)
  /** Products plus the "See all" row. */
  const rowCount = items.length ? items.length + 1 : 0

  // Ask once the visitor pauses; a newer keystroke cancels the older request.
  useEffect(() => {
    if (!canSuggest) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setFailed(false)
      searchProducts(query, controller.signal)
        .then((found) => {
          setResults(found)
          setResultsFor(query)
          setActive(-1)
          setLoading(false)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setResults(null)
          setFailed(true)
          setLoading(false)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, canSuggest])

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  const pick = (product: ProductSuggestion) => {
    close()
    onPickProduct(product)
  }

  const seeAll = () => {
    close()
    formRef.current?.requestSubmit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (event.key === 'ArrowDown' && canSuggest) setOpen(true)
      return
    }
    if (event.key === 'ArrowDown' && rowCount) {
      event.preventDefault()
      setActive((index) => (index + 1) % rowCount)
    } else if (event.key === 'ArrowUp' && rowCount) {
      event.preventDefault()
      setActive((index) => (index <= 0 ? rowCount - 1 : index - 1))
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter' && active >= 0 && active < items.length && resultsFor === query) {
      event.preventDefault()
      pick(items[active])
    }
    // Enter on "See all", with nothing highlighted, or while the list still
    // shows the previous words' results submits the form as a full search.
  }

  return (
    <div>
      <form
        ref={formRef}
        role="search"
        onSubmit={(event) => {
          close()
          onSubmit(event)
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <label htmlFor={id} className="sr-only">
          Search products
        </label>
        <div className="relative flex-1">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="M13.5 13.5L17 17" />
          </svg>
          <input
            id={id}
            type="search"
            value={keyword}
            onChange={(event) => {
              onKeywordChange(event.target.value)
              setTyped(true)
              setOpen(true)
              setActive(-1)
            }}
            onFocus={() => setOpen(true)}
            onBlur={close}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? optionId(listId, active) : undefined}
            placeholder="Search by product name, size or SKU…"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={MAX_QUERY_LENGTH}
            className="w-full rounded-card border border-slate-200 bg-slate-50 py-4 pl-13 pr-12 text-ink outline-none transition-all placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-brand-blue [&::-webkit-search-cancel-button]:hidden"
          />
          {/* Tells screen-reader users how many suggestions appeared. */}
          <p role="status" aria-live="polite" className="sr-only">
            {showList && !loading && results ? `${items.length} product suggestions` : ''}
          </p>
          {keyword ? (
            <button
              type="button"
              onClick={() => {
                close()
                setTyped(false)
                setResults(null)
                onClear()
              }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          ) : null}
          {showList ? (
            <SearchSuggestions
              id={listId}
              query={keyword}
              results={results}
              loading={loading}
              failed={failed}
              activeIndex={active}
              onActiveChange={setActive}
              onPick={pick}
              onSeeAll={seeAll}
            />
          ) : null}
        </div>
        <button
          type="submit"
          disabled={buttonDisabled}
          className="rounded-card bg-brand-blue px-8 py-4 font-bold text-white shadow-cta transition-all hover:bg-brand-blue-dark disabled:opacity-50 active:scale-98"
        >
          {buttonLabel}
        </button>
      </form>
      {note ? (
        <p role="status" className="mt-3 px-1 text-sm text-slate-500">
          {note}
        </p>
      ) : null}
    </div>
  )
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

/** Longest search text the site accepts, from the box or a ?q= link. */
export const MAX_QUERY_LENGTH = 100

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

/** A search on another page, e.g. "/inventory?q=napkin". */
const searchUrl = (path: string, raw: string) => {
  const query = raw.trim().replace(/\s+/g, ' ')
  return query ? `${path}?q=${encodeURIComponent(query)}` : path
}

const same =(a = '', b = '') => a.trim().toLowerCase() === b.trim().toLowerCase()

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
 * Site-styled product search that drives the embedded storefront through
 * Ecwid's JS API. Built as our own component (not Ecwid's search widget)
 * because the dynamic embed only supports the main ProductBrowser widget —
 * and this way it matches the rest of the site exactly.
 * Docs: https://docs.ecwid.com/storefronts/open-page-on-the-storefront/open-search-page-with-params
 */
export function StoreSearch({ ready, resultsId, initialQuery = '', searchPath, unavailable = false }: StoreSearchProps) {
  const router = useRouter()
  const [keyword, setKeyword] = useState(initialQuery)
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
    if (!ready || searchPath) return

    const root = () => document.getElementById(resultsId)

    return onStorePageLoaded((page: EcwidPage) => {
      if (page.type !== 'SEARCH') {
        // The visitor left the search (a product, category, the cart…). Drop
        // ?q= so a reload or shared link shows this page rather than the old
        // search, and let the same search run again. A search that is still
        // opening (pending) passes through the store's front page first.
        if (!pendingPlain.current && !pendingPrefix.current && lastOpened.current !== null) {
          lastOpened.current = null
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
  }, [ready, resultsId, searchPath])

  const showResults = () => {
    document.getElementById(resultsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** A suggestion was chosen: open that product here, or on the hub page. */
  const pickProduct = (product: ProductSuggestion) => {
    if (searchPath) {
      router.push(`${searchPath}${product.route}`)
      return
    }
    // A product page isn't a search: don't let ?q= reopen the search on reload.
    lastOpened.current = null
    setUrlQuery('')
    try {
      if (!ready || !window.Ecwid?.openPage) throw new Error('store not ready')
      window.Ecwid.openPage('product', { id: product.id })
    } catch {
      // The store reads its route from the URL when it finishes loading.
      window.location.hash = product.route
    }
    showResults()
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

    setKeyword(query)
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
  useEffect(() => {
    openQueryRef.current = openQuery
  })

  // Apply a query that arrived with the page, after Ecwid's API exists.
  // The timeout lets StrictMode cancel the first pass before it touches the store.
  useEffect(() => {
    if (!initialQuery) return
    // An old link with ?q= on a page that searches elsewhere: send it there.
    if (searchPath) {
      router.replace(searchUrl(searchPath, initialQuery))
      return
    }
    if (!ready) return
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
  }, [ready, initialQuery, searchPath, router])

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searchPath) {
      router.push(searchUrl(searchPath, keyword))
      return
    }
    // Pressing Search always runs it, even for the same words as last time.
    lastOpened.current = null
    openQuery(keyword, true)
  }

  const clear = () => {
    lastOpened.current = null
    setKeyword('')
    setNote('')
    if (searchPath) return
    searchRun.current += 1
    pendingPlain.current = null
    pendingPrefix.current = null
    if (ready) window.Ecwid?.openPage?.('category')
    setUrlQuery('')
  }

  return (
    <ProductSearchForm
      id="store-search"
      keyword={keyword}
      onKeywordChange={setKeyword}
      onSubmit={search}
      onClear={clear}
      onPickProduct={pickProduct}
      buttonLabel={ready || searchPath ? 'Search' : unavailable ? 'Store unavailable' : 'Loading store…'}
      buttonDisabled={!ready && !searchPath}
      note={note}
    />
  )
}
