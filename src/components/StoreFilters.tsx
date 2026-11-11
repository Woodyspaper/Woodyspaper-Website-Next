'use client'

import { useEffect, useRef, useState } from 'react'
import { PRODUCT_FILTERS, filtersEnabled, loadFilterFacets } from '@/services/productFilters'
import type { FilterFacets, FilterValue } from '@/services/productFilters'
import { onStorePageLoaded } from '@/services/storePages'
import type { EcwidPage } from './LightSpeedStore'

type StoreFiltersProps = {
  /** False until the storefront API is usable. */
  ready: boolean
}

/** Lists longer than this get a "find" box. */
const FIND_BOX_FROM = 12

const isOurs = (key: string) => PRODUCT_FILTERS.some((filter) => filter.key === key)

/**
 * What the store is showing, as the parameters its search page takes
 * (keyword, categories, inventory, attribute_Brand, option_COLOR…). Null on
 * pages with no product list (a product, the cart, the account).
 */
function readContext(page: EcwidPage): Record<string, string> | null {
  if (page.type !== 'SEARCH' && page.type !== 'CATEGORY') return null
  const params: Record<string, string> = {}
  const filters = page.filterParams ?? {}

  for (const [name, value] of Object.entries(filters)) {
    // Plain settings (inventory, onsale, price range…) carry over as they are.
    if (name !== 'includeProductsFromSubcategories' && (typeof value === 'string' || typeof value === 'number')) {
      params[name] = String(value)
    }
  }
  for (const [name, values] of Object.entries(filters.attributes ?? {})) {
    if (values.length) params[`attribute_${name}`] = values.join(',')
  }
  for (const [name, values] of Object.entries(filters.options ?? {})) {
    if (values.length) params[`option_${name}`] = values.join(',')
  }

  if (page.type === 'SEARCH') {
    if (page.keywords) params.keyword = page.keywords
    if (filters.categories?.length) params.categories = filters.categories.join(',')
    if (page.sort && page.sort !== 'relevance') params.sort = page.sort
  } else if (page.categoryId) {
    params.categories = String(page.categoryId)
  }
  return params
}

/**
 * Brand / Color / Finish / Type filters above the store's product list.
 *
 * Each is a menu of checkboxes with product counts, limited to the values
 * found in what's on show (the open category or search). Ticking one opens the
 * store's search page with that filter added; the store's own "Refine by"
 * choices (stock, price…) are kept. Clearing the last one goes back to the
 * category, or the store's front page.
 *
 * See services/productFilters.ts for why these aren't Lightspeed's own filters.
 */
export function StoreFilters({ ready }: StoreFiltersProps) {
  const [context, setContext] = useState<Record<string, string> | null>(null)
  const [facets, setFacets] = useState<FilterFacets | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => onStorePageLoaded((page) => setContext(readContext(page))), [])

  // Ask which values exist for what the store now shows.
  const contextKey = context ? JSON.stringify(context) : ''
  useEffect(() => {
    if (!contextKey) return
    const controller = new AbortController()
    loadFilterFacets(JSON.parse(contextKey) as Record<string, string>, controller.signal)
      .then((found) => setFacets(found))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFacets(null) // the row hides; the store's own filters still work
      })
    return () => controller.abort()
  }, [contextKey])

  // While a menu is open, Esc or a click outside the row closes it.
  useEffect(() => {
    if (!openKey) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenKey(null)
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenKey(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [openKey])

  if (!filtersEnabled || !ready || !context || !facets) return null

  const chosen = (key: string) => (context[key] ? context[key].split(',') : [])
  const anyChosen = PRODUCT_FILTERS.some((filter) => chosen(filter.key).length > 0)

  /** Shows the store's products for `next`: a search, or the plain category / front page. */
  const show = (next: Record<string, string>) => {
    setContext(next) // tick the box now; the store confirms when its page loads
    try {
      const keys = Object.keys(next)
      const onlyCategory = keys.length === 1 && keys[0] === 'categories' && /^\d+$/.test(next.categories)
      if (keys.length === 0) window.Ecwid?.openPage?.('category')
      else if (onlyCategory) window.Ecwid?.openPage?.('category', { id: Number(next.categories) })
      else window.Ecwid?.openPage?.('search', next)
    } catch {
      // The store was mid-load; the next page it reports resets the boxes.
    }
  }

  const toggle = (key: string, value: string) => {
    const values = chosen(key)
    const nextValues = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
    const next = { ...context }
    if (nextValues.length) next[key] = nextValues.join(',')
    else delete next[key]
    show(next)
  }

  const clearAll = () => {
    setOpenKey(null)
    show(Object.fromEntries(Object.entries(context).filter(([key]) => !isOurs(key))))
  }

  /** Values on offer, plus any chosen ones the current results no longer contain. */
  const valuesFor = (key: string): FilterValue[] => {
    const offered = facets[key] ?? []
    const missing = chosen(key).filter((value) => !offered.some((entry) => entry.value === value))
    return [...missing.map((value) => ({ value, count: 0 })), ...offered]
  }

  const shown = PRODUCT_FILTERS.filter((filter) => valuesFor(filter.key).length > 0)
  if (shown.length === 0) return null

  return (
    // On phones the menus hang from this row (not their own button), so none runs off the screen.
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-semibold text-slate-500">Filter by</span>
      {shown.map((filter) => {
        const values = valuesFor(filter.key)
        const picked = chosen(filter.key)
        const isOpen = openKey === filter.key
        const menuId = `store-filter-${filter.key}`
        const needle = find.trim().toLowerCase()
        const listed = isOpen && needle ? values.filter((entry) => entry.value.toLowerCase().includes(needle)) : values

        return (
          <div key={filter.key} className="sm:relative">
            <button
              type="button"
              onClick={() => {
                setFind('')
                setOpenKey(isOpen ? null : filter.key)
              }}
              aria-expanded={isOpen}
              aria-controls={menuId}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${
                picked.length
                  ? 'border-brand-blue bg-brand-mist text-brand-blue-dark'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brand-blue/40 hover:text-brand-blue'
              }`}
            >
              {filter.label}
              {picked.length ? (
                <span className="grid min-w-5 place-items-center rounded-full bg-brand-blue px-1.5 text-xs font-bold text-white">
                  {picked.length}
                </span>
              ) : null}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>

            {isOpen ? (
              <div
                id={menuId}
                role="group"
                aria-label={`${filter.label} filter`}
                className="absolute left-0 top-full z-30 mt-2 w-full rounded-card sm:w-72 border border-slate-200 bg-white p-2 shadow-lift"
              >
                {values.length > FIND_BOX_FROM ? (
                  <input
                    type="search"
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                    placeholder={`Find a ${filter.label.toLowerCase()}…`}
                    aria-label={`Find a ${filter.label.toLowerCase()}`}
                    className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:ring-2 focus:ring-brand-blue"
                  />
                ) : null}
                <ul className="max-h-72 overflow-y-auto">
                  {listed.map((entry) => (
                    <li key={entry.value}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink transition-colors hover:bg-brand-mist">
                        <input
                          type="checkbox"
                          checked={picked.includes(entry.value)}
                          onChange={() => toggle(filter.key, entry.value)}
                          className="size-4 shrink-0 accent-brand-blue"
                        />
                        <span className="min-w-0 flex-1 wrap-break-word">{entry.value}</span>
                        {entry.count ? <span className="shrink-0 text-xs text-slate-500 tabular-nums">{entry.count}</span> : null}
                      </label>
                    </li>
                  ))}
                  {listed.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">Nothing matches “{find.trim()}”.</li> : null}
                </ul>
              </div>
            ) : null}
          </div>
        )
      })}
      {anyChosen ? (
        <button
          type="button"
          onClick={clearAll}
          className="rounded-full px-3 py-2 text-sm font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-brand-blue"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  )
}
