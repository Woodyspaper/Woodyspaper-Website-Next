'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LOGIN_PATH, useAccount } from '@/services/account'
import { PRODUCTS_PER_BRAND, loadBrands } from '@/services/brandShowcase'
import type { Brand } from '@/services/brandShowcase'
import { Reveal } from './Reveal'

const HUB_PATH = '/inventory'

/** How long each brand stays up before the carousel moves on by itself. */
const AUTO_ADVANCE_MS = 5000

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

const arrowClasses =
  'flex size-11 items-center justify-center rounded-full border border-brand-blue/30 bg-white text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d={direction === 'left' ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'} />
    </svg>
  )
}

/**
 * "Brands we carry" on the home page: a carousel with one slide per brand,
 * showing a few of that brand's in-stock products with photo and list price.
 * Brands and products come live from Lightspeed (services/brandShowcase.ts).
 *
 * The slides are a sideways-scrolling strip with scroll snapping, so swiping
 * on a phone, the arrow buttons, the brand tabs and the keyboard all move
 * the same thing. If the store can't be reached the section isn't shown.
 */
export function BrandCarousel() {
  const account = useAccount()
  /** null while loading; [] when there is nothing to show. */
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [active, setActive] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const tabRow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    void loadBrands().then((list) => {
      if (live) setBrands(list)
    })
    return () => {
      live = false
    }
  }, [])

  /** The slide a button, tab or the timer has sent the strip towards, until it gets there. */
  const heading = useRef<number | null>(null)

  /**
   * Shows a slide: marks it current straight away and scrolls the strip to
   * it. Past either end it wraps round to the other.
   */
  const show = useCallback((index: number, count: number) => {
    const node = strip.current
    if (!node || count === 0) return
    const target = ((index % count) + count) % count
    heading.current = target
    setActive(target)
    node.scrollTo({ left: target * node.clientWidth, behavior: 'smooth' })
    // If the scroll never reports arriving (it was interrupted), stop waiting for it.
    window.setTimeout(() => {
      if (heading.current === target) heading.current = null
    }, 1500)
  }, [])

  const brandCount = brands?.length ?? 0
  const goTo = (index: number) => show(index, brandCount)

  /** True while the pointer or keyboard focus is on the carousel: someone is reading or choosing. */
  const [paused, setPaused] = useState(false)

  /*
   * Moves on to the next brand every AUTO_ADVANCE_MS, back to the first after
   * the last. It waits while the visitor is on the carousel (hover or focus)
   * or the tab is in the background, and starts its count again after any
   * move, so a brand someone picked isn't whisked away.
   *
   * Visitors whose system asks for reduced motion (Windows with animations
   * off, for one) still get the next brand, but it appears at once without
   * sliding: globals.css turns smooth scrolling off for them.
   */
  useEffect(() => {
    if (brandCount < 2 || paused) return
    const timer = window.setInterval(() => {
      if (!document.hidden) show(active + 1, brandCount)
    }, AUTO_ADVANCE_MS)
    return () => window.clearInterval(timer)
  }, [brandCount, active, paused, show])

  /**
   * Swiping or the keyboard moved the strip: the slide nearest its left edge
   * becomes the current one. While a button, tab or the timer is scrolling it
   * somewhere, the slides passed on the way are ignored.
   */
  const onScroll = () => {
    const node = strip.current
    if (!node || node.clientWidth === 0) return
    const nearest = Math.round(node.scrollLeft / node.clientWidth)
    if (heading.current !== null) {
      if (nearest === heading.current) heading.current = null
      return
    }
    setActive(nearest)
  }

  // On phones the tab row scrolls sideways: keep the current brand's tab in view.
  // Only the row itself is scrolled, never the page.
  useEffect(() => {
    const row = tabRow.current
    const tab = row?.children[active] as HTMLElement | undefined
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return
    row.scrollTo({ left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  if (brands?.length === 0) return null

  return (
    <Reveal as="section" className="px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Brands we carry</h2>
            <p className="mt-2 text-base text-slate-600">
              Names you know, in stock at our warehouse. Prices shown are list prices
              {account ? (
                '; your account pricing applies in the cart.'
              ) : (
                <>
                  ;{' '}
                  <Link href={LOGIN_PATH} className={linkClasses}>
                    sign in
                  </Link>{' '}
                  for your account pricing.
                </>
              )}
            </p>
          </div>
          {brands ? (
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" aria-label="Previous brand" onClick={() => goTo(active - 1)} className={arrowClasses}>
                <Arrow direction="left" />
              </button>
              <button type="button" aria-label="Next brand" onClick={() => goTo(active + 1)} className={arrowClasses}>
                <Arrow direction="right" />
              </button>
            </div>
          ) : null}
        </div>

        {brands === null ? (
          // A placeholder the size of a slide, so the page doesn't jump when the brands arrive.
          <div className="rounded-panel border border-slate-100 bg-white p-6 shadow-glass sm:p-8" aria-hidden="true">
            <div className="mb-6 h-8 w-48 animate-pulse rounded-full bg-slate-100" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: PRODUCTS_PER_BRAND }, (_, index) => (
                <div key={index} className="aspect-3/4 animate-pulse rounded-card bg-slate-100" />
              ))}
            </div>
          </div>
        ) : (
          // Hovering or tabbing into the carousel holds it still (see the auto-advance effect).
          <div
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
          >
            {/* Brand tabs: every brand at a glance, and a way to jump to one. */}
            <div
              ref={tabRow}
              role="tablist"
              aria-label="Brands"
              className="relative mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
            >
              {brands.map((brand, index) => (
                <button
                  key={brand.name}
                  type="button"
                  role="tab"
                  aria-selected={active === index}
                  onClick={() => goTo(index)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${
                    active === index
                      ? 'border-brand-blue bg-brand-blue text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-brand-blue/40 hover:text-brand-blue'
                  }`}
                >
                  {brand.name}
                </button>
              ))}
            </div>

            <div
              ref={strip}
              onScroll={onScroll}
              // Arrow keys scroll the strip when it has focus.
              tabIndex={0}
              aria-roledescription="carousel"
              aria-label="Brands we carry"
              className="flex snap-x snap-mandatory overflow-x-auto rounded-panel border border-slate-100 bg-white shadow-glass [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue [&::-webkit-scrollbar]:hidden"
            >
              {brands.map((brand, index) => (
                <div
                  key={brand.name}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${brand.name}, ${index + 1} of ${brands.length}`}
                  className="w-full shrink-0 snap-start p-5 sm:p-8"
                >
                  <div className="mb-5 flex flex-col items-center gap-2 text-center sm:flex-row sm:items-baseline sm:justify-between sm:text-left">
                    <div className="flex flex-col items-center gap-x-4 gap-y-1 sm:flex-row sm:items-baseline">
                      <h3 className="font-sans text-2xl font-black uppercase tracking-wide text-ink sm:text-3xl">{brand.name}</h3>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                        {brand.inStockCount.toLocaleString('en-US')} {brand.inStockCount === 1 ? 'product' : 'products'} in stock
                      </p>
                    </div>
                    <Link href={`${HUB_PATH}${brand.route}`} className={`shrink-0 text-sm ${linkClasses}`}>
                      Shop all {brand.name} →
                    </Link>
                  </div>

                  <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                    {brand.products.map((product) => (
                      <li key={product.id}>
                        <Link
                          href={`${HUB_PATH}${product.route}`}
                          className="group flex h-full flex-col overflow-hidden rounded-card border border-slate-100 bg-white transition-[translate,box-shadow] duration-300 ease-brand hover:-translate-y-1 hover:shadow-lift focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue"
                        >
                          {/* Store photos are already sized thumbnails; served as-is like the rest of the site. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={product.image} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain p-3" />
                          <span className="flex flex-1 flex-col gap-2 border-t border-slate-100 p-3 sm:p-4">
                            <span className="line-clamp-3 text-xs font-semibold leading-snug text-ink transition-colors group-hover:text-brand-blue sm:text-sm">
                              {product.name}
                            </span>
                            {product.sku ? <span className="text-xs text-slate-500">SKU {product.sku}</span> : null}
                            <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
                              <span className="text-base font-bold text-brand-blue tabular-nums sm:text-lg">{product.price}</span>
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-3xs font-black uppercase tracking-wider text-emerald-700 sm:text-xs sm:font-semibold sm:normal-case sm:tracking-normal">
                                In stock
                              </span>
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Position dots. The tabs above are the labelled controls; these just show where you are. */}
            <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div className="flex justify-center gap-1.5" aria-hidden="true">
                {brands.map((brand, index) => (
                  <span
                    key={brand.name}
                    className={`h-1.5 rounded-full transition-all duration-300 ${active === index ? 'w-6 bg-brand-blue' : 'w-1.5 bg-slate-300'}`}
                  />
                ))}
              </div>
              {/* The way out to everything else, under the carousel where it doesn't compete with the brands. */}
              <Link
                href={HUB_PATH}
                className="rounded-full border border-brand-blue/30 bg-white px-7 py-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
              >
                All products →
              </Link>
            </div>
          </div>
        )}
      </div>
    </Reveal>
  )
}
