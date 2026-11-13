'use client'

import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, searchProducts, suggestionsEnabled } from '@/services/productSearch'
import type { ProductSuggestion, SuggestionResults } from '@/services/productSearch'
import { STORE_PATH, listHref } from '@/services/storeRoutes'
import { SearchSuggestions, optionId } from './SearchSuggestions'

const INPUT_ID = 'site-search'
const LIST_ID = `${INPUT_ID}-suggestions`

/**
 * The product search in the header, on every page. While the visitor types it
 * suggests matching products (services/productSearch.ts); Enter, the Search
 * button or "See all" runs the full store search.
 *
 * A full search opens the product list (/inventory?q=…), where the filters
 * and sort can narrow it further; a picked suggestion opens that product's
 * page.
 *
 * Reads ?q= with useSearchParams, so render it inside <Suspense>.
 */
export function HeaderSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  /** The search the product list is showing, which it keeps in ?q=. */
  // The built site's addresses end in a slash (/inventory/); the dev server's don't.
  const shownQuery = pathname.replace(/\/$/, '') === STORE_PATH ? (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH) : ''

  const [keyword, setKeyword] = useState(shownQuery)
  /** Suggestions only follow the visitor's own typing, not a query filled in from the URL. */
  const [typed, setTyped] = useState(false)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SuggestionResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  /** The words the current `results` were found for. */
  const [resultsFor, setResultsFor] = useState('')

  // Follow the list: a search opened from a link fills the box, and leaving
  // the search (a product, a category, another page) empties it.
  const [lastShown, setLastShown] = useState(shownQuery)
  if (lastShown !== shownQuery) {
    setLastShown(shownQuery)
    setKeyword(shownQuery)
    setTyped(false)
  }

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

  /** Runs the full search: the product list, showing what matches. */
  const runSearch = () => {
    close()
    router.push(listHref({ q: query.replace(/\s+/g, ' ') }))
  }

  const pick = (product: ProductSuggestion) => {
    close()
    setKeyword('')
    setTyped(false)
    router.push(product.href)
  }

  const clear = () => {
    close()
    setKeyword('')
    setTyped(false)
    setResults(null)
    // Clearing a search the list is showing goes back to all products.
    if (shownQuery) router.push(STORE_PATH)
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
    <form
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        runSearch()
      }}
      className="relative"
    >
      <label htmlFor={INPUT_ID} className="sr-only">
        Search products
      </label>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5L17 17" />
      </svg>
      <input
        id={INPUT_ID}
        type="search"
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value)
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
        aria-controls={LIST_ID}
        aria-activedescendant={showList && active >= 0 ? optionId(LIST_ID, active) : undefined}
        placeholder="Napkins, tissue, cups, SKU…"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={MAX_QUERY_LENGTH}
        // text-base on phones: iOS zooms the page for inputs under 16px.
        className="h-11 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-32 text-base text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-brand-blue lg:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {/* Tells screen-reader users how many suggestions appeared. */}
      <p role="status" aria-live="polite" className="sr-only">
        {showList && !loading && results ? `${items.length} product suggestions` : ''}
      </p>
      {keyword ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-24 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      ) : null}
      <button
        type="submit"
        className="absolute inset-y-1 right-1 rounded-full bg-brand-blue px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
      >
        Search
      </button>
      {showList ? (
        <SearchSuggestions
          id={LIST_ID}
          query={keyword}
          results={results}
          loading={loading}
          failed={failed}
          activeIndex={active}
          onActiveChange={setActive}
          onPick={pick}
          onSeeAll={runSearch}
        />
      ) : null}
    </form>
  )
}
