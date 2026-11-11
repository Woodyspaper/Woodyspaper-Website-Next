'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTilt } from '@/hooks/useTilt'
import { ACCOUNT_PAGE, SIGNUP_PATH, useAccount } from '@/services/account'
import { loadCatalogSize } from '@/services/categories'

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=1000'

/** Short reasons to buy here, under the buttons. Keep each one true and checkable. */
const PROMISES = ['Warehouse direct', 'Dispatched daily across South Florida', 'Account pricing for regular buyers']

/** 1126 → "1,100+": a round number that stays true as the catalog grows. */
const roundedCount = (total: number) => `${(Math.floor(total / 50) * 50).toLocaleString('en-US')}+`

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-brand-blue" aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  )
}

/**
 * Top of the home page. Its job is to get visitors into the store: one clear
 * line about what we sell, a button to the products, and a second button to
 * an account (where regular buyers get their pricing).
 */
export function HeroSection() {
  const tiltRef = useTilt<HTMLDivElement>()
  const account = useAccount()
  /** Live product count from the store; the sentence reads fine without it. */
  const [catalogSize, setCatalogSize] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void loadCatalogSize().then((total) => {
      if (live) setCatalogSize(total)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="px-4 pb-10 pt-10 sm:pt-14 lg:pb-14 lg:pt-16">
      <div className="mx-auto grid max-w-7xl items-center gap-10 text-center lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:text-left">
        <div>
          <p className="mb-4 text-xs font-black uppercase tracking-ultra text-brand-blue">
            Sustainably sourced · Responsibly delivered
          </p>
          <h1 className="mb-5 text-4xl font-bold leading-hero tracking-tight sm:text-5xl lg:text-6xl">
            Paper &amp; packaging,
            <br />
            <span className="font-light italic text-brand-blue">warehouse direct.</span>
          </h1>
          <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0">
            Envelopes, printing paper, food packaging and more
            {catalogSize ? (
              <>
                : <strong className="font-semibold text-ink">{roundedCount(catalogSize)} products</strong>
              </>
            ) : null}
            , dispatched daily across South Florida.
          </p>

          <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Link
              href="/inventory"
              className="rounded-full bg-brand-blue px-9 py-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Shop all products
            </Link>
            <Link
              href={account ? ACCOUNT_PAGE : SIGNUP_PATH}
              className="rounded-full border border-brand-blue/30 bg-white px-9 py-4 text-base font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              {account ? 'Your account' : 'Get account pricing'}
            </Link>
          </div>

          <ul className="mt-8 flex flex-col items-center gap-x-6 gap-y-2 text-sm font-semibold text-slate-600 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-center gap-2">
                <CheckIcon />
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <div className="tilt-stage">
          <div ref={tiltRef} className="tilt-target relative mx-auto max-w-lg lg:max-w-none">
            {/* Plain <img>: an external photo with an onError fallback. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://woodyspaper.com/image_ba5a41.jpg"
              alt="Woody's Paper distribution centre in South Florida"
              loading="eager"
              onError={(event) => {
                // Swap to the backup photo once; if that fails too, stop (no retry loop).
                const image = event.currentTarget
                if (image.dataset.fallback) return
                image.dataset.fallback = 'true'
                image.src = FALLBACK_IMAGE
              }}
              className="aspect-4/3 w-full rounded-panel border-4 border-white object-cover shadow-lift"
            />
            <a
              href="tel:7547011797"
              className="absolute -bottom-4 -right-2 hidden rounded-card border border-slate-100 bg-white px-5 py-4 text-left shadow-lift transition-colors hover:border-brand-blue/30 xs:block sm:-right-6"
            >
              <span className="block text-3xs font-black uppercase tracking-ultra text-brand-blue sm:text-xs">
                Talk to the warehouse
              </span>
              <span className="mt-1 block text-lg font-bold leading-none text-slate-900 sm:text-2xl">(754) 701-1797</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
