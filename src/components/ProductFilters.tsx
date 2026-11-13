'use client'

import { useEffect, useRef, useState } from 'react'
import { filtersEnabled, loadFilterFacets } from '@/services/productFilters'
import type { FilterFacets, FilterValue } from '@/services/productFilters'
import { PRODUCT_FILTERS, facetParams } from '@/services/storeRoutes'
import type { ListQuery } from '@/services/storeRoutes'
import { Skeleton } from './Skeleton'

type ProductFiltersProps = {
  /** What the list is showing. */
  query: ListQuery
  /** Shows the list for a changed query (the page puts it in the address). */
  onChange: (next: ListQuery) => void
}

/** Lists longer than this get a "find" box. */
const FIND_BOX_FROM = 12

/**
 * Brand / Color / Finish / Type / Sold-by filters above the product list.
 *
 * Each is a menu of checkboxes with product counts, limited to the values
 * found among the products on show (the open category or search, and the
 * other filters). Ticking one narrows the list.
 */
export function ProductFilters({ query, onChange }: ProductFiltersProps) {
  const [facets, setFacets] = useState<FilterFacets | null>(null)
  /** The view whose filter values have been asked for and answered (or have failed). */
  const [settledKey, setSettledKey] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Ask which values exist for what the list now shows.
  const contextKey = JSON.stringify(facetParams(query))
  useEffect(() => {
    const controller = new AbortController()
    loadFilterFacets(JSON.parse(contextKey) as Record<string, string>, controller.signal)
      .then((found) => {
        setFacets(found)
        setSettledKey(contextKey)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // Already retried (storeApi.ts). The row hides; search and categories still work.
        setFacets(null)
        setSettledKey(contextKey)
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

  if (!filtersEnabled) return null

  // The first set of filter values is still loading: placeholders the size of the row.
  if (!facets && settledKey !== contextKey) {
    return (
      <div role="status" aria-label="Loading filters" className="flex flex-wrap items-center gap-2">
        <Skeleton className="mr-1 h-4 w-14" />
        {PRODUCT_FILTERS.map((filter) => (
          <Skeleton key={filter.key} className="h-9 w-24" />
        ))}
      </div>
    )
  }

  if (!facets) return null

  const chosen = (key: string) => query.filters[key] ?? []
  const anyChosen = PRODUCT_FILTERS.some((filter) => chosen(filter.key).length > 0)

  const toggle = (key: string, value: string) => {
    const values = chosen(key)
    const nextValues = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
    const filters = { ...query.filters }
    if (nextValues.length) filters[key] = nextValues
    else delete filters[key]
    // A narrower or wider list starts again from its first page.
    onChange({ ...query, filters, page: 1 })
  }

  const clearAll = () => {
    setOpenKey(null)
    onChange({ ...query, filters: {}, page: 1 })
  }

  /** Values on offer, plus any chosen ones the current results no longer contain. */
  const valuesFor = (key: string): FilterValue[] => {
    const offered = facets[key] ?? []
    const missing = chosen(key).filter((value) => !offered.some((entry) => entry.value === value))
    return [...missing.map((value) => ({ value, count: 0 })), ...offered]
  }

  // A filter with a single value on offer (and none chosen) wouldn't narrow anything.
  const shown = PRODUCT_FILTERS.filter((filter) => chosen(filter.key).length > 0 || valuesFor(filter.key).length > 1)
  if (shown.length === 0) return null

  return (
    // On phones the menus hang from this row (not their own button), so none runs off the screen.
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-semibold text-slate-500">Filter by</span>
      {shown.map((filter) => {
        const values = valuesFor(filter.key)
        const picked = chosen(filter.key)
        const isOpen = openKey === filter.key
        const menuId = `product-filter-${filter.param}`
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
                className="absolute left-0 top-full z-30 mt-2 w-full rounded-card border border-slate-200 bg-white p-2 shadow-lift sm:w-72"
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
