'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LOGIN_PATH, useAccount } from '@/services/account'
import { PRODUCTS_PER_BRAND, loadBrands } from '@/services/brandShowcase'
import type { Brand } from '@/services/brandShowcase'
import { Reveal } from './Reveal'
import { LoadError, Skeleton } from './Skeleton'

const HUB_PATH = '/inventory'

/** How long each brand stays up before the carousel moves on by itself. */
const AUTO_ADVANCE_MS = 5000

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

/**
 * "Brands we carry" on the home page: a carousel with one slide per brand,
 * showing a few of that brand's in-stock products with photo and list price.
 * Brands and products come live from Lightspeed (services/brandShowcase.ts).
 *
 * The slides are a sideways-scrolling strip with scroll snapping, so swiping
 * on a phone, the brand tabs and the keyboard all move
 * the same thing. While the brands load, a placeholder the size of a slide
 * holds the space. If the store can't be reached even after retrying, the
 * section says so and offers a button to try again.
 */
export function BrandCarousel() {
  const account = useAccount()
  /** null while loading; [] when there is nothing to show. */
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [active, setActive] = useState(0)
  const strip = useRef<HTMLDivElement>(null)
  const tabRow = useRef<HTMLDivElement>(null)

  /** The brands couldn't be loaded (after the automatic retries). */
  const [failed, setFailed] = useState(false)
  /** Goes up each time the visitor presses "Try again", which re-runs the load below. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    loadBrands().then(
      (list) => {
        if (live) setBrands(list)
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  const tryAgain = () => {
    setFailed(false)
    setAttempt((count) => count + 1)
  }

  /** The slide a tab or the timer has sent the strip towards, until it gets there. */
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
   * becomes the current one. While a tab or the timer is scrolling it
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
          {/* The way out to everything else, beside the heading where it doesn't compete with the brands. */}
          <Link
            href={HUB_PATH}
            className="shrink-0 rounded-full border border-brand-blue/30 bg-white px-7 py-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
          >
            All products →
          </Link>
        </div>

        {failed ? (
          <LoadError onRetry={tryAgain}>
            We couldn&rsquo;t load our brands just now. You can still{' '}
            <Link href={HUB_PATH} className={linkClasses}>
              browse all products
            </Link>
            , or call (754) 701-1797.
          </LoadError>
        ) : brands === null ? (
          // Placeholders the size of the tabs and a slide, so the page doesn't jump when the brands arrive.
          <div role="status" aria-label="Loading brands">
            <div className="mb-5 flex gap-2 overflow-hidden">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-28 shrink-0" />
              ))}
            </div>
            <div className="rounded-panel border border-slate-100 bg-white p-5 shadow-glass sm:p-8">
              <Skeleton className="mb-6 h-8 w-56" />
              <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                {Array.from({ length: PRODUCTS_PER_BRAND }, (_, index) => (
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
                    <Link href={brand.href} className={`shrink-0 text-sm ${linkClasses}`}>
                      Shop all {brand.name} →
                    </Link>
                  </div>

                  <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                    {brand.products.map((product) => (
                      <li key={product.id}>
                        <Link
                          href={product.href}
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

            {/* Position dots: show where you are, and jump to a brand when clicked. */}
            <div className="mt-3 flex justify-center">
              {brands.map((brand, index) => (
                // The button is bigger than the dot it draws, so it is easy to hit with a finger.
                <button
                  key={brand.name}
                  type="button"
                  aria-label={`Show ${brand.name}`}
                  aria-current={active === index ? 'true' : undefined}
                  onClick={() => goTo(index)}
                  className="group flex h-8 items-center px-1 focus-visible:outline-2 focus-visible:outline-brand-blue"
                >
                  <span
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      active === index ? 'w-6 bg-brand-blue' : 'w-1.5 bg-slate-300 group-hover:bg-brand-blue/60'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Reveal>
  )
}
