'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { catalogEnabled, loadProducts } from '@/services/catalog'
import type { ProductPage } from '@/services/catalog'
import { loadCategories } from '@/services/categories'
import { PAGE_SIZE, SORTS, legacyHref, listHref, parseListQuery } from '@/services/storeRoutes'
import type { ListQuery, SortValue } from '@/services/storeRoutes'
import { AccountPrompt } from './AccountPrompt'
import { ProductCardView } from './ProductCardView'
import { ProductFilters } from './ProductFilters'
import { LoadError, Skeleton } from './Skeleton'

const pagerClasses =
  'rounded-full border border-brand-blue/30 bg-white px-5 py-2.5 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-40 disabled:hover:bg-white'

/**
 * The product list (/inventory): the store's products with search, category,
 * filters, sort and paging, all read from the page address
 * (services/storeRoutes.ts), so a view can be shared and Back returns to it.
 *
 * Reads the address with useSearchParams, so render it inside <Suspense>.
 */
export function InventoryContent() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const search = params.toString()
  const query = parseListQuery(new URLSearchParams(search))
  const queryKey = JSON.stringify(query)

  const [page, setPage] = useState<ProductPage | null>(null)
  /** The view `page` (or a failure) belongs to; while it differs from the current one, the list is loading. */
  const [settledKey, setSettledKey] = useState('')
  const [failed, setFailed] = useState(false)
  /** Goes up each time the visitor presses "Try again". */
  const [attempt, setAttempt] = useState(0)
  const [categoryName, setCategoryName] = useState('')

  // A link made for the old embedded store (/inventory#!/…/p/123): send it to the page that shows it now.
  useEffect(() => {
    const target = legacyHref(window.location.hash)
    if (target) router.replace(target)
  }, [router])

  useEffect(() => {
    if (!catalogEnabled) return
    const controller = new AbortController()
    loadProducts(JSON.parse(queryKey) as ListQuery, controller.signal)
      .then((found) => {
        setPage(found)
        setFailed(false)
        setSettledKey(queryKey)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFailed(true)
        setSettledKey(queryKey)
      })
    return () => controller.abort()
  }, [queryKey, attempt])

  // The open category's name, for the heading.
  const categoryId = query.category
  useEffect(() => {
    if (!categoryId) return
    let live = true
    loadCategories()
      .then((list) => {
        if (live) setCategoryName(list.find((category) => category.id === categoryId)?.name ?? '')
      })
      .catch(() => undefined) // The heading just says "Products".
    return () => {
      live = false
    }
  }, [categoryId])

  const heading = query.q ? `Results for “${query.q}”` : (categoryId && categoryName) || 'All products'
  useEffect(() => {
    document.title = `${heading} | Woody's Paper`
  }, [heading])

  /** Shows another view by changing the address; the effects above follow it. */
  const show = (next: ListQuery, scrollUp = false) => {
    router.push(listHref(next), { scroll: scrollUp })
  }

  const loading = settledKey !== queryKey
  const total = page?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = (query.page - 1) * PAGE_SIZE + 1
  const last = Math.min(total, query.page * PAGE_SIZE)
  const narrowed = Boolean(query.q || query.category || query.inStock || Object.keys(query.filters).length)

  if (!catalogEnabled) {
    return (
      <section className="px-4 py-16">
        <p className="mx-auto max-w-xl rounded-card border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Online store unavailable — set <code>NEXT_PUBLIC_LIGHTSPEED_STORE_ID</code> and{' '}
          <code>NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN</code> in <code>.env.local</code>.
        </p>
      </section>
    )
  }

  return (
    <section id="products" className="scroll-mt-chrome px-4 py-10 sm:py-14 lg:scroll-mt-chrome-lg">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{heading}</h1>
          <AccountPrompt />
        </div>

        <div className="rounded-panel border border-slate-100 bg-white p-4 shadow-glass sm:p-8">
          <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6">
            <ProductFilters query={query} onChange={(next) => show(next)} />
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className="text-sm text-slate-600" aria-live="polite">
                {loading && !page ? 'Loading products…' : total === 0 ? 'No products' : `Showing ${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={query.inStock}
                    onChange={(event) => show({ ...query, inStock: event.target.checked, page: 1 })}
                    className="size-4 accent-brand-blue"
                  />
                  In stock only
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  Sort
                  <select
                    value={query.sort}
                    onChange={(event) => show({ ...query, sort: event.target.value as SortValue, page: 1 })}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30"
                  >
                    {SORTS.map((sort) => (
                      <option key={sort.value} value={sort.value}>
                        {sort.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          {failed && !loading ? (
            <LoadError onRetry={() => { setSettledKey(''); setAttempt((count) => count + 1) }}>
              We couldn&rsquo;t load our products just now. Try again, or call (754) 701-1797 for pricing and availability.
            </LoadError>
          ) : !page || (loading && !page.items.length) ? (
            <div role="status" aria-label="Loading products" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="overflow-hidden rounded-card border border-slate-100">
                  <Skeleton className="aspect-square rounded-none" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : total === 0 ? (
            <div className="py-10 text-center">
              <p className="text-lg font-semibold text-ink">Nothing matches{query.q ? ` “${query.q}”` : ' those filters'}.</p>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
                Check the spelling, try fewer words or a SKU, or call (754) 701-1797 and we&rsquo;ll find it for you.
              </p>
              {narrowed ? (
                <button type="button" onClick={() => router.push(pathname)} className={`mt-5 ${pagerClasses}`}>
                  Show all products
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {page.searchedFor ? (
                <p className="mb-5 rounded-card bg-brand-mist px-5 py-3 text-sm text-ink">
                  Nothing matched “{query.q}”, so these are the results for <strong>“{page.searchedFor}”</strong>.
                </p>
              ) : null}
              {/* Dimmed while the next view loads, so the list doesn't blink empty in between. */}
              <ul className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 ${loading ? 'opacity-50' : ''}`}>
                {page.items.map((product) => (
                  <ProductCardView key={product.id} product={product} />
                ))}
              </ul>
              {pageCount > 1 ? (
                <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-4">
                  <button type="button" disabled={query.page <= 1} onClick={() => show({ ...query, page: query.page - 1 }, true)} className={pagerClasses}>
                    ← Previous
                  </button>
                  <span className="text-sm font-semibold text-slate-600">
                    Page {Math.min(query.page, pageCount)} of {pageCount}
                  </span>
                  <button type="button" disabled={query.page >= pageCount} onClick={() => show({ ...query, page: query.page + 1 }, true)} className={pagerClasses}>
                    Next →
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
