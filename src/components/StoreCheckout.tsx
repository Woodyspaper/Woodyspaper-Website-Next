'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { startCart } from '@/services/cart'
import { STORE_ID, storeNeedsSsoRestart, storeReady, storeScriptStarted } from '@/services/storeScript'
import { STORE_PATH, productHref } from '@/services/storeRoutes'
import { Skeleton } from './Skeleton'
import { StoreAccount } from './StoreAccount'
import { StoreSignInHelp } from './StoreSignInHelp'

const CONTAINER_ID = `my-store-${STORE_ID}`

/** Set once this page view has started the store with the checkout in it. */
let startedHere = false

/**
 * The checkout page (/checkout): Lightspeed's own cart, address, delivery and
 * payment steps, drawn by its script inside this page and themed to match
 * (storeScript.ts). The store's account pages (orders, addresses) open here
 * too, with ?account=1.
 *
 * Everything before this point is the site's own. If the store tries to show
 * one of its product or category pages here (its "continue shopping" links),
 * the visitor is sent to ours instead.
 *
 * Reads the address with useSearchParams, so render it inside <Suspense>.
 */
export function StoreCheckout() {
  const wantsAccount = useSearchParams().has('account')
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!STORE_ID) return
    /*
     * The store decides what to draw when its script loads. If the script is
     * already running on this page view (the visitor came here without a full
     * page load, or signed in since it started), start the page afresh so it
     * loads with the checkout, and with their sign-in.
     */
    if ((!startedHere && storeScriptStarted()) || storeNeedsSsoRestart()) {
      window.location.reload()
      return
    }
    startedHere = true

    // The store reads its page from the hash: open the cart (or the account pages), not its front page.
    if (!window.location.hash.startsWith('#!')) {
      window.history.replaceState(null, '', `${window.location.pathname}${wantsAccount ? '#!/~/account' : '#!/~/cart'}`)
    }
    window._xnext_initialization_scripts = [
      {
        widgetType: 'ProductBrowser',
        id: CONTAINER_ID,
        arg: ['categoryView=grid', 'searchView=grid', 'defaultCategoryId=0', `id=${CONTAINER_ID}`],
      },
    ]

    let live = true
    storeReady()
      .then((ecwid) => {
        // The header's cart follows the same store.
        startCart()
        // The store can't remove a listener; it lives as long as this page view, like the checkout.
        ecwid.OnPageLoaded?.add((page) => {
          if (page.type === 'PRODUCT' && page.productId) window.location.assign(productHref(page.productId))
          else if (page.type === 'CATEGORY' || page.type === 'SEARCH' || page.type === 'PRODUCT') window.location.assign(STORE_PATH)
        })
        if (live) setReady(true)
      })
      .catch(() => {
        if (live) setFailed(true)
      })

    /*
     * Leaving for another page of the site: make it a full page load, so the
     * store there starts again without the checkout drawn.
     */
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (link.target && link.target !== '_self') return
      if (link.origin !== window.location.origin || link.pathname.replace(/\/$/, '') === window.location.pathname.replace(/\/$/, '')) return
      event.preventDefault()
      event.stopPropagation()
      window.location.assign(link.href)
    }
    document.addEventListener('click', leave, true)
    return () => {
      live = false
      document.removeEventListener('click', leave, true)
    }
  }, [wantsAccount])

  if (!STORE_ID) {
    return (
      <p className="mx-auto my-16 max-w-xl rounded-card border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        Checkout unavailable — set <code>NEXT_PUBLIC_LIGHTSPEED_STORE_ID</code> in <code>.env.local</code>.
      </p>
    )
  }

  return (
    <section className="px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{wantsAccount ? 'Orders & store account' : 'Checkout'}</h1>
          <StoreAccount ready={ready} resultsId={CONTAINER_ID} />
        </div>

        {/*
          Panel styling deliberately avoids backdrop-blur, transforms and
          overflow-hidden: each would trap or clip the store's full-screen
          pop-ups.
        */}
        <div className="rounded-panel border border-slate-100 bg-white p-4 shadow-glass sm:p-8">
          {failed ? (
            <div role="alert" className="rounded-card border border-brand-blue/20 bg-brand-mist p-6 text-center text-ink">
              <p className="text-lg font-semibold">The checkout didn&rsquo;t load.</p>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
                A browser extension may be blocking it, or it&rsquo;s briefly unavailable. Try again, or call{' '}
                <a href="tel:7547011797" className="font-semibold text-brand-blue underline">
                  (754) 701-1797
                </a>{' '}
                to place your order.
              </p>
              {/* The store's script can't be restarted cleanly in place, so trying again reloads the page. */}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-full border border-brand-blue/30 bg-white px-6 py-2.5 text-sm font-semibold text-brand-blue transition-colors hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
              >
                Try again
              </button>
            </div>
          ) : null}
          {wantsAccount ? <StoreSignInHelp /> : null}
          <div className="relative">
            {/* min-h keeps the page from jumping while the checkout loads. */}
            <div id={CONTAINER_ID} className="min-h-96 scroll-mt-chrome lg:scroll-mt-chrome-lg" />
            {/* The store draws into the div above (which must stay empty of our own elements), so the placeholder sits on top of it. */}
            {!ready && !failed ? (
              <div role="status" aria-label="Loading the checkout" className="absolute inset-0 space-y-4 bg-white">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-24 w-full rounded-card" />
                <Skeleton className="h-24 w-full rounded-card" />
                <Skeleton className="h-12 w-56" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
