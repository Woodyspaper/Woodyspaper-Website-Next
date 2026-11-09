'use client'

import type { ReactNode } from 'react'
import type { ProductSuggestion, SuggestionResults } from '@/services/productSearch'

type SearchSuggestionsProps = {
  /** id of the listbox; the input points at it with aria-controls. */
  id: string
  query: string
  results: SuggestionResults | null
  loading: boolean
  failed: boolean
  /** Highlighted row: 0..items-1 are products, items.length is "See all". */
  activeIndex: number
  onActiveChange: (index: number) => void
  onPick: (product: ProductSuggestion) => void
  onSeeAll: () => void
}

/** id of each row, for aria-activedescendant. */
export const optionId = (listId: string, index: number) => `${listId}-option-${index}`

/** Wraps the typed words inside `text` in <mark> so the match stands out. */
function highlight(text: string, query: string): ReactNode {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return text
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'))
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-brand-mist font-semibold text-brand-blue-dark">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

/**
 * Product suggestions under the store search box. Pure display: the search
 * form owns what's typed, the fetching and the keyboard.
 */
export function SearchSuggestions({
  id,
  query,
  results,
  loading,
  failed,
  activeIndex,
  onActiveChange,
  onPick,
  onSeeAll,
}: SearchSuggestionsProps) {
  const items = results?.items ?? []
  const total = results?.total ?? 0
  const trimmed = query.trim()

  return (
    <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-card border border-slate-200 bg-white shadow-lift">
      <ul id={id} role="listbox" aria-label="Product suggestions" className="max-h-[min(28rem,60vh)] overflow-y-auto py-2">
        {items.map((product, index) => (
          <li
            key={product.id}
            id={optionId(id, index)}
            role="option"
            aria-selected={activeIndex === index}
            // Keep focus in the input while choosing with the mouse.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveChange(index)}
            onClick={() => onPick(product)}
            className={`flex cursor-pointer items-center gap-4 px-4 py-2.5 transition-colors ${
              activeIndex === index ? 'bg-brand-mist' : ''
            }`}
          >
            {/* Store photos are already sized thumbnails; the static export serves images as-is. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image || '/product-placeholder.webp'}
              alt=""
              loading="lazy"
              className="size-14 shrink-0 rounded-xl border border-slate-100 bg-white object-contain"
            />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm leading-snug text-ink">{highlight(product.name, trimmed)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {product.sku ? <span>SKU {product.sku}</span> : null}
                {!product.inStock ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Out of stock</span>
                ) : null}
              </span>
            </span>
            {product.price ? (
              <span className="shrink-0 text-sm font-bold text-brand-blue tabular-nums">{product.price}</span>
            ) : null}
          </li>
        ))}

        {items.length > 0 ? (
          <li
            id={optionId(id, items.length)}
            role="option"
            aria-selected={activeIndex === items.length}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveChange(items.length)}
            onClick={onSeeAll}
            className={`mx-2 mt-1 cursor-pointer rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-blue transition-colors ${
              activeIndex === items.length ? 'bg-brand-mist' : ''
            }`}
          >
            See all {total > items.length ? `${total} ` : ''}results for “{trimmed}”
          </li>
        ) : null}
      </ul>

      {items.length === 0 ? (
        <p role="status" className="px-5 py-4 text-sm text-slate-500">
          {loading
            ? 'Searching…'
            : failed
              ? 'Suggestions are unavailable right now. Press Enter to search.'
              : `No products match “${trimmed}”. Try a shorter word, a size like 8.5x11, or a SKU, or call (754) 701-1797.`}
        </p>
      ) : null}
    </div>
  )
}
