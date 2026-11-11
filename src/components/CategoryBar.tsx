'use client'

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { loadCategories } from '@/services/categories'
import type { StoreCategory } from '@/services/categories'
import { onStorePageLoaded, requestStorePage } from '@/services/storePages'
import type { EcwidPage } from './LightSpeedStore'

const HUB_PATH = '/inventory'

const pillClasses =
  'shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

/**
 * The store's categories in a bar under the header, on every page: "All
 * products", the top-level categories in a row that scrolls sideways, and an
 * "All categories" menu listing every one.
 *
 * Each is a link to /inventory with that category open. On /inventory itself
 * the store is asked to open it in place (services/storePages.ts).
 *
 * Fixed under the header on desktop; on mobile it sits at the top of the page
 * and scrolls away with it, so the fixed bars don't eat the screen.
 */
export function CategoryBar() {
  const pathname = usePathname()
  const onHub = pathname === HUB_PATH
  const [categories, setCategories] = useState<StoreCategory[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  /** The store page on show, to mark the current category. */
  const [storePage, setStorePage] = useState<EcwidPage | null>(null)
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let live = true
    loadCategories()
      .then((list) => {
        if (live) setCategories(list)
      })
      .catch(() => {
        // The bar still offers "All products"; the store lists its categories too.
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => onStorePageLoaded(setStorePage), [])

  // Another page: close the menu, and forget which store page was showing.
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setMenuOpen(false)
    setStorePage(null)
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

  /** 0 on the store's front page, a category's id on its page, otherwise null. */
  const activeId = onHub && storePage?.type === 'CATEGORY' ? (storePage.categoryId ?? 0) : null

  /** On the hub the store opens the category in place; elsewhere the link navigates. */
  const open = (event: MouseEvent<HTMLAnchorElement>, category?: StoreCategory) => {
    setMenuOpen(false)
    if (event.ctrlKey || event.metaKey || event.shiftKey) return // new tab or window: let the link work
    if (requestStorePage({ kind: 'category', id: category?.id ?? 0, route: category?.route ?? '' })) {
      event.preventDefault()
    }
  }

  return (
    <nav
      ref={barRef}
      aria-label="Product categories"
      className="relative z-30 border-b border-slate-200/80 bg-white lg:fixed lg:inset-x-0 lg:top-bars-lg lg:z-40 lg:bg-white/90 lg:backdrop-blur-lg"
    >
      <div className="mx-auto flex h-catbar max-w-7xl items-center gap-3 px-4">
        <Link
          href={HUB_PATH}
          onClick={(event) => open(event)}
          aria-current={activeId === 0 ? 'page' : undefined}
          className={`${pillClasses} ${
            activeId === 0
              ? 'border-brand-blue bg-brand-blue text-white'
              : 'border-brand-blue/30 bg-white text-brand-blue hover:bg-brand-mist'
          }`}
        >
          All products
        </Link>

        {categories.length > 0 ? (
          <>
            <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
            {/* Scrolls sideways when the categories don't fit; the fade hints at more. */}
            <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto mask-[linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categories.map((category) => (
                <li key={category.id} className="shrink-0 last:pr-8">
                  <Link
                    href={`${HUB_PATH}${category.route}`}
                    onClick={(event) => open(event, category)}
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
                    href={`${HUB_PATH}${category.route}`}
                    onClick={(event) => open(event, category)}
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
