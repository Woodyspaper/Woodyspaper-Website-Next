'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { inventoryPath } from '@/paths'
import type { EcwidPage } from './LightSpeedStore'

type StoreSearchProps = {
  /** False until the storefront script has loaded and its JS API is usable. */
  ready: boolean
  /** id of the store container — results are counted inside it and scrolled to. */
  resultsId: string
  /** Query from the hub URL, applied once the storefront can open a search. */
  initialQuery?: string
}

type ProductSearchFormProps = {
  id: string
  keyword: string
  onKeywordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClear: () => void
  buttonLabel: string
  buttonDisabled?: boolean
  note?: string
}

/** Shared search field used on the home preview and on the inventory hub. */
export function ProductSearchForm({
  id,
  keyword,
  onKeywordChange,
  onSubmit,
  onClear,
  buttonLabel,
  buttonDisabled = false,
  note = '',
}: ProductSearchFormProps) {
  return (
    <div>
      <form role="search" onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
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
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="Search by product name, size or SKU…"
            autoComplete="off"
            enterKeyHint="search"
            className="w-full rounded-card border border-slate-200 bg-slate-50 py-4 pl-13 pr-12 text-ink outline-none transition-all placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-brand-blue [&::-webkit-search-cancel-button]:hidden"
          />
          {keyword ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
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

/** Only one Ecwid.OnPageLoaded subscription is ever made (Ecwid can't remove one). */
let activeHandler: ((page: EcwidPage) => void) | null = null

function subscribeToPageLoads() {
  const ecwid = window.Ecwid as (Window['Ecwid'] & { __woodysSearchHook?: boolean }) | undefined
  if (!ecwid?.OnPageLoaded || ecwid.__woodysSearchHook) return
  ecwid.OnPageLoaded.add((page) => activeHandler?.(page))
  ecwid.__woodysSearchHook = true
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
 * Site-styled product search that drives the embedded storefront through
 * Ecwid's JS API. Built as our own component (not Ecwid's search widget)
 * because the dynamic embed only supports the main ProductBrowser widget —
 * and this way it matches the rest of the site exactly.
 * Docs: https://docs.ecwid.com/storefronts/open-page-on-the-storefront/open-search-page-with-params
 */
export function StoreSearch({ ready, resultsId, initialQuery = '' }: StoreSearchProps) {
  const [keyword, setKeyword] = useState(initialQuery)
  const [note, setNote] = useState('')
  /**
   * Keeps ?q= in step with the store without adding a history entry.
   * Native replaceState (which Next syncs into useSearchParams) rather than
   * router.replace: the store pushes its own #!/ URL at the same moment, and
   * that cancels a pending router navigation. The store's hash is kept.
   */
  const setUrlQuery = (query: string) =>
    window.history.replaceState(null, '', inventoryPath(query) + window.location.hash)
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

  useEffect(() => {
    if (!ready) return
    subscribeToPageLoads()

    const root = () => document.getElementById(resultsId)

    activeHandler = (page) => {
      if (page.type !== 'SEARCH') return
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
    }

    return () => {
      activeHandler = null
    }
  }, [ready, resultsId])

  const showResults = () => {
    document.getElementById(resultsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
        lastOpened.current = null
        window.setTimeout(() => openQueryRef.current(raw, updateUrl), 400)
        return
      }
      if (updateUrl) setUrlQuery(query)
    } else {
      pendingPlain.current = null
      if (!openStorePage('category')) {
        lastOpened.current = null
        window.setTimeout(() => openQueryRef.current(raw, updateUrl), 400)
        return
      }
      if (updateUrl) setUrlQuery('')
    }
    showResults()
  }

  const openQueryRef = useRef(openQuery)
  useEffect(() => {
    openQueryRef.current = openQuery
  })

  // Apply a query that arrived with the page, after Ecwid's API exists.
  // The timeout lets StrictMode cancel the first pass before it touches the store.
  useEffect(() => {
    if (!ready || !initialQuery) return
    const timer = window.setTimeout(() => openQueryRef.current(initialQuery, false), 0)
    return () => window.clearTimeout(timer)
  }, [ready, initialQuery])

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    openQuery(keyword, true)
  }

  const clear = () => {
    lastOpened.current = null
    setKeyword('')
    setNote('')
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
      buttonLabel={ready ? 'Search' : 'Loading store…'}
      buttonDisabled={!ready}
      note={note}
    />
  )
}
