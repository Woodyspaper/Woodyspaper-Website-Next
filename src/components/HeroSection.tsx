'use client'

import Link from 'next/link'
import { useTilt } from '@/hooks/useTilt'

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=1000'

export function HeroSection() {
  const tiltRef = useTilt<HTMLDivElement>()

  return (
    <section className="px-4 py-12 sm:py-16 lg:py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-12 text-center lg:grid-cols-2 lg:gap-16 lg:text-left">
        <div>
          <h1 className="mb-6 text-4xl font-bold leading-hero tracking-tight sm:text-5xl lg:text-6xl">
            Sustainably Sourced,
            <br />
            <span className="font-light italic text-brand-blue">Responsibly</span> Delivered.
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0 lg:text-xl">
            Wholesale packaging and paper solutions dispatched daily across South Florida.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Link
              href="/inventory"
              className="rounded-full bg-brand-blue px-8 py-3.5 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Check Inventory
            </Link>
            <a
              href="tel:7547011797"
              className="rounded-full border border-brand-blue/30 bg-white px-8 py-3.5 text-base font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Call Warehouse
            </a>
          </div>
        </div>

        <div className="tilt-stage mt-8 lg:mt-0">
          <div ref={tiltRef} className="tilt-target relative mx-auto max-w-lg lg:max-w-none">
            {/* Plain <img>: an external photo with an onError fallback, served as-is in the static export. */}
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
            <div className="absolute -bottom-4 -right-2 hidden rounded-card border border-slate-100 bg-white px-5 py-4 shadow-lift xs:block sm:-right-6">
              <p className="text-3xs font-black uppercase tracking-tighter text-brand-blue sm:text-xs">
                Warehouse Direct
              </p>
              <p className="mt-1 text-lg font-bold leading-none text-slate-900 sm:text-2xl">
                Optimized Fulfillment
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
