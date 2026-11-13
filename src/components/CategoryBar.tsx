'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { loadCategories } from '@/services/categories'
import type { StoreCategory } from '@/services/categories'
import { STORE_PATH, parseListQuery } from '@/services/storeRoutes'
import { Skeleton } from './Skeleton'

const pillClasses =
  'shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

/**
 * The store's categories in a bar under the header, on every page: "All
 * products", the top-level categories in a row that scrolls sideways, and an
 * "All categories" menu listing every one.
 *
 * Each is a link to the product list (/inventory) showing that category.
 * Reads the address with useSearchParams, so render it inside <Suspense>.
 *
 * Fixed under the header on desktop; on mobile it sits at the top of the page
 * and scrolls away with it, so the fixed bars don't eat the screen.
 */
export function CategoryBar() {
  const pathname = usePathname()
  const params = useSearchParams()
  // The built site's addresses end in a slash (/inventory/); the dev server's don't.
  const onHub = pathname.replace(/\/$/, '') === STORE_PATH
  const [categories, setCategories] = useState<StoreCategory[]>([])
  /** True until the category list has arrived or failed. */
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let live = true
    loadCategories()
      .then((list) => {
        if (live) setCategories(list)
      })
      .catch(() => {
        // Already retried (storeApi.ts). The bar still offers "All products", so no error is shown.
      })
      .finally(() => {
        if (live) setLoadingCategories(false)
      })
    return () => {
      live = false
    }
  }, [])

  // Another page: close the menu.
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setMenuOpen(false)
  }

  // While the menu is open, Esc or a click outside the bar closes it.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [menuOpen])

  /** On the product list: the category on show, or 0 for all products. Otherwise null. */
  const listQuery = onHub ? parseListQuery(new URLSearchParams(params.toString())) : null
  const activeId = listQuery ? (listQuery.category ?? (listQuery.q ? null : 0)) : null

  const open = () => setMenuOpen(false)

  return (
    <nav
      ref={barRef}
      aria-label="Product categories"
      className="relative z-30 border-b border-slate-200/80 bg-white lg:fixed lg:inset-x-0 lg:top-bars-lg lg:z-40 lg:bg-white/90 lg:backdrop-blur-lg"
    >
      <div className="mx-auto flex h-catbar max-w-7xl items-center gap-3 px-4">
        <Link
          href={STORE_PATH}
          onClick={open}
          aria-current={activeId === 0 ? 'page' : undefined}
          className={`${pillClasses} ${
            activeId === 0
              ? 'border-brand-blue bg-brand-blue text-white'
              : 'border-brand-blue/30 bg-white text-brand-blue hover:bg-brand-mist'
          }`}
        >
          All products
        </Link>

        {loadingCategories ? (
          // Placeholders the height of the category links, while the list loads.
          <div role="status" aria-label="Loading categories" className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-24 shrink-0" />
            ))}
          </div>
        ) : categories.length > 0 ? (
          <>
            <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
            {/* Scrolls sideways when the categories don't fit; the fade hints at more. */}
            <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto mask-[linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((category) => (
                <li key={category.id} className="shrink-0 last:pr-8">
                  <Link
                    href={category.href}
                    onClick={open}
                    aria-current={activeId === category.id ? 'page' : undefined}
                    className={`block rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors hover:text-brand-blue focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue ${
                      activeId === category.id ? 'text-brand-blue' : 'text-slate-600'
                    }`}
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setMenuOpen((isOpen) => !isOpen)}
              aria-expanded={menuOpen}
              aria-controls="all-categories"
              className={`${pillClasses} flex items-center gap-2 border-brand-blue/30 bg-white text-brand-blue hover:bg-brand-mist`}
            >
              <span className="hidden sm:inline">All categories</span>
              <span className="sm:hidden">All</span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`size-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>
          </>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <div id="all-categories" hidden={!menuOpen} className="absolute inset-x-0 top-full">
          <div className="mx-auto max-w-7xl px-4">
            <ul className="ml-auto mt-2 grid max-h-[70vh] w-full max-w-3xl grid-cols-1 gap-1 overflow-y-auto rounded-card border border-slate-200 bg-white p-3 shadow-lift xs:grid-cols-2 md:grid-cols-3">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={category.href}
                    onClick={open}
                    aria-current={activeId === category.id ? 'page' : undefined}
                    className={`block rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-brand-mist hover:text-brand-blue focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue ${
                      activeId === category.id ? 'bg-brand-mist text-brand-blue' : 'text-slate-700'
                    }`}
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </nav>
  )
}
