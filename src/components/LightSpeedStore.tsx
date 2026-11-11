'use client'

import { useEffect, useState } from 'react'
import { api, hasStoreSsoHint, takePendingStoreSignOut } from '@/services/account'
import { openStoreAccount, signOutOfStore, watchStoreCustomer } from '@/services/storeCustomer'
import type { EcwidCustomer } from '@/services/storeCustomer'
import { StoreAccount } from './StoreAccount'
import { StoreFilters } from './StoreFilters'
import { StoreSearch } from './StoreSearch'

/**
 * Lightspeed E-Series (Ecwid) storefront, embedded with Ecwid's documented
 * "dynamic widget" pattern so it survives React mounting, unmounting and
 * StrictMode's double-invoked effects.
 *
 * The raw embed snippet can't be pasted into JSX: React never executes
 * <script> tags it renders, so xProductBrowser() never ran.
 *
 * Docs:
 *  - Embedding:      https://docs.ecwid.com/api-reference/rest-api/storefront-widget-details/dynamic-loading-for-storefront-widget
 *  - Design configs: https://docs.ecwid.com/storefronts/store-configuration-settings/design-configs
 *  - Cart widget:    https://support.ecwid.com/hc/en-us/articles/360000013659-Adding-shopping-bag-to-a-custom-site
 */

type Visibility = 'SHOW' | 'HIDE' | 'SHOW_ON_HOVER'

/**
 * Storefront design overrides. Anything left unset falls back to
 * Lightspeed admin → Design, so only set what the website should force.
 */
export type StoreDesign = Partial<{
  /** Gap between product cards. */
  productListCardSpacingType: 'wide' | 'medium' | 'narrow'
  /** Alignment of name / price / SKU on product cards. */
  product_list_product_info_layout: 'CENTER' | 'LEFT' | 'JUSTIFY' | 'RIGHT'
  product_list_show_product_images: boolean
  product_list_title_behavior: Visibility
  product_list_price_behavior: Visibility
  product_list_buybutton_behavior: Visibility
  /** Where category names sit on category tiles. */
  product_list_category_title_behavior: 'SHOW_ON_IMAGE' | 'SHOW_BELOW_IMAGE' | 'HIDE' | 'SHOW_ON_HOVER'
  /** Product page gallery arrangement. */
  product_details_gallery_layout: 'IMAGE_SINGLE_THUMBNAILS_HORIZONTAL' | 'IMAGE_SINGLE_THUMBNAILS_VERTICAL' | 'IMAGE_FEED'
}>

type EcwidWidget = {
  widgetType: 'ProductBrowser'
  id: string
  arg: string[]
}

/** The subset of Ecwid's OnPageLoaded page object the site uses. */
export type EcwidPage = {
  type: string
  keywords?: string
  categoryId?: number
  sort?: string
  /** Filters applied to a category or search page's product list. */
  filterParams?: {
    /** Attribute name → chosen values, e.g. { Brand: ['HAMMERMILL'] }. */
    attributes?: Record<string, string[]>
    /** Option name → chosen values, e.g. { COLOR: ['PINK'] }. */
    options?: Record<string, string[]>
    categories?: number[]
    /** Others (inventory, onsale, price range…) are plain values. */
    [setting: string]: unknown
  }
}

type ChameleonTheme = {
  colors: Record<'color-background' | 'color-foreground' | 'color-link' | 'color-button' | 'color-price', string>
  font: { 'font-family': string }
}

declare global {
  interface Window {
    ecwid_script_defer?: boolean
    ecwid_dynamic_widgets?: boolean
    _xnext_initialization_scripts?: EcwidWidget[]
    ec?: {
      storefront?: Record<string, unknown>
      config?: { chameleon?: ChameleonTheme } & Record<string, unknown>
    }
    Ecwid?: {
      destroy: () => void
      init?: () => void
      refreshConfig?: () => void
      openPage?: (page: string, params?: Record<string, unknown>) => void
      OnAPILoaded?: { add: (callback: () => void) => void }
      OnPageLoaded?: { add: (callback: (page: EcwidPage) => void) => void }
      OnSetProfile?: { add: (callback: (customer: EcwidCustomer) => void) => void }
      Customer?: {
        get: (callback: (customer: EcwidCustomer) => void) => void
        signOut?: (callback?: () => void) => void
      }
      /** Single sign-on: signs the store in ('' signs out). Only works if ecwid_sso_profile was defined at load. */
      setSsoProfile?: (payload: string) => void
    }
    /** Defined (even as '') puts the store in single sign-on mode and hides its own sign-in links. */
    ecwid_sso_profile?: string
    /** Set by this site once the store script was started in single sign-on mode. */
    __woodysStoreSso?: boolean
    ecwid_onBodyDone?: () => void
  }
}

/** Public store ID — it appears in the page source regardless, so it's not a secret. */
const DEFAULT_STORE_ID = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID
const SCRIPT_ID = 'ecwid-script'

/** Reads a design token from index.css so the store tracks the site theme. */
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** Ecwid's colour + font settings, derived from the site's @theme tokens. */
const siteTheme = (): ChameleonTheme => {
  const blue = token('--color-brand-blue', '#0070bb')
  return {
    colors: {
      'color-background': '#ffffff', // the store sits on a white panel
      'color-foreground': token('--color-ink', '#172235'),
      'color-link': blue,
      'color-button': blue,
      'color-price': blue,
    },
    font: { 'font-family': token('--font-sans', "'Inter', sans-serif") },
  }
}

/**
 * The shopping bag isn't supported by the dynamic embed (ProductBrowser only),
 * so it's started with Ecwid.init(), which finds every `.ec-cart-widget` on
 * the page. Ecwid.init() also processes _xnext_initialization_scripts, so the
 * list is emptied for the call — otherwise it could draw the store a second
 * time — and put back afterwards for later remounts.
 */
function initCartWidget() {
  const init = window.Ecwid?.init
  if (!init || !document.querySelector('.ec-cart-widget')) return
  const widgets = window._xnext_initialization_scripts
  window._xnext_initialization_scripts = []
  try {
    init.call(window.Ecwid)
  } finally {
    window._xnext_initialization_scripts = widgets
  }
}

type LightSpeedStoreProps = {
  storeId?: string
  /**
   * Products loaded per category/search page before pagination.
   * Columns per row are NOT set here — the grid is responsive, so columns
   * follow card size (admin → Design) and the width of this container.
   */
  productsPerPage?: number
  /** Category to open first. 0 = the store's home page. */
  defaultCategoryId?: number
  design?: StoreDesign
  /** Search to open once the storefront API is ready. Comes from the page URL (?q=). */
  initialQuery?: string
  /** Show Lightspeed's shopping bag (item count, opens the cart) above the store. */
  showCart?: boolean
  /** Show the customer account control (sign in / my account / sign out). */
  showAccount?: boolean
  /** Open the store's account page (sign-in form when signed out) once ready. */
  openAccount?: boolean
  className?: string
}

export function LightSpeedStore({
  storeId = DEFAULT_STORE_ID,
  productsPerPage = 30,
  defaultCategoryId = 0,
  design = {},
  showCart = true,
  showAccount = true,
  openAccount = false,
  initialQuery = '',
  className = '',
}: LightSpeedStoreProps) {
  const containerId = `my-store-${storeId}`
  // Serialised so a fresh object literal on each render doesn't reload the store.
  const designKey = JSON.stringify(design)
  const [apiReady, setApiReady] = useState(false)
  /** The store script failed or never became usable (blocked, offline, outage). */
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!storeId) return
    /** Set on cleanup, so late callbacks from this mount do nothing. */
    let disposed = false

    // Theme + design configs must be in place before the storefront renders.
    window.ec = window.ec || {}
    window.ec.config = { ...window.ec.config, chameleon: siteTheme() }
    window.ec.storefront = { ...window.ec.storefront, ...(JSON.parse(designKey) as StoreDesign) }

    window.ecwid_script_defer = true
    window.ecwid_dynamic_widgets = true
    window.Ecwid?.destroy()
    window._xnext_initialization_scripts = [
      {
        widgetType: 'ProductBrowser',
        id: containerId,
        arg: [
          // Ecwid multiplies the two grid numbers: grid(1,N) = N products per page.
          `views=grid(1,${productsPerPage}) list(${productsPerPage}) table(${productsPerPage})`,
          'categoryView=grid',
          'searchView=grid',
          `defaultCategoryId=${defaultCategoryId}`,
          `id=${containerId}`,
        ],
      },
    ]

    /** A fresh single sign-on string to hand the store once it's ready (remounts only). */
    let ssoRefresh: string | null = null
    /** The browser expected single sign-on, but the server says this visitor no longer has it. */
    let ssoEnded = false

    const loadStore = () => {
      if (!document.getElementById(SCRIPT_ID)) {
        // First mount: the script reads _xnext_initialization_scripts when it loads.
        const script = document.createElement('script')
        script.id = SCRIPT_ID
        script.charset = 'utf-8'
        script.dataset.cfasync = 'false'
        script.src = `https://app.business.shop/script.js?${storeId}&data_platform=code`
        script.onerror = () => {
          // Blocked or offline. Remove the tag so the next visit to a store page tries again.
          script.remove()
          if (!disposed) setLoadFailed(true)
        }
        document.body.appendChild(script)
      } else {
        // Remount / settings change: re-run init (no-op if still loading).
        window.Ecwid?.refreshConfig?.()
        window.ecwid_onBodyDone?.()
      }
    }

    /*
     * Single sign-on, only for customers whose store account was created
     * through the website (see src/server/lightspeed.ts). The store reads
     * ecwid_sso_profile when its script loads, so the sign-on string is
     * fetched first. Everyone else skips this and the store loads at once,
     * with its own sign-in.
     */
    if (hasStoreSsoHint()) {
      const scriptLoaded = Boolean(document.getElementById(SCRIPT_ID))
      // The store clears ecwid_sso_profile once it has read it, so the mode it
      // started in is remembered separately.
      if (scriptLoaded && !window.__woodysStoreSso) {
        // The store already started without single sign-on in this tab (they
        // signed in afterwards). It can't switch modes, so start the page over.
        window.location.reload()
        return
      }
      api<{ payload: string | null }>('/api/lightspeed/sso')
        .then(({ payload }) => {
          if (disposed) return
          if (!payload) {
            // Their website session ended without a sign-out (it expired, or was
            // ended from another browser): the store's sign-in ends with it.
            ssoEnded = true
            return
          }
          window.ecwid_sso_profile = payload
          window.__woodysStoreSso = true
          // An already-loaded store won't re-read the variable; it's told once ready.
          if (scriptLoaded) ssoRefresh = payload
        })
        .catch(() => undefined) // Server unreachable: the store opens signed out.
        .finally(() => {
          if (!disposed) loadStore()
        })
    } else {
      loadStore()
    }

    // openPage throws until OnAPILoaded, even after the function itself exists.
    // The timeout covers a storefront build that never replays that callback.
    let readyMarked = false
    let readyFallback = 0
    const markReady = () => {
      // OnAPILoaded can't be unsubscribed: ignore calls meant for an earlier mount.
      if (readyMarked || disposed) return
      readyMarked = true
      window.clearTimeout(readyFallback)
      if (ssoRefresh) {
        try {
          window.Ecwid?.setSsoProfile?.(ssoRefresh)
        } catch {
          // The store stays as it was.
        }
      }
      initCartWidget()
      watchStoreCustomer()
      // They signed out of the website since the store last ran: the store's
      // remembered sign-in (made by the website) goes too.
      if (takePendingStoreSignOut() || ssoEnded) signOutOfStore()
      setApiReady(true)
    }
    const poll = window.setInterval(() => {
      const ecwid = window.Ecwid
      if (typeof ecwid?.openPage !== 'function') return
      window.clearInterval(poll)
      if (ecwid.OnAPILoaded) {
        ecwid.OnAPILoaded.add(markReady)
        readyFallback = window.setTimeout(markReady, 4000)
      } else {
        markReady()
      }
    }, 250)
    const giveUp = window.setTimeout(() => {
      window.clearInterval(poll)
      if (readyMarked || disposed) return
      setLoadFailed(true)
      // The script loaded but the store never started: let the next visit retry from scratch.
      if (!window.Ecwid) document.getElementById(SCRIPT_ID)?.remove()
    }, 30_000)

    return () => {
      disposed = true
      window.clearInterval(poll)
      window.clearTimeout(giveUp)
      window.clearTimeout(readyFallback)
      window.Ecwid?.destroy()
      setApiReady(false)
    }
  }, [storeId, containerId, productsPerPage, defaultCategoryId, designKey])

  // "Sign In" / "My Account" links elsewhere on the site arrive as ?account=1.
  // Open the account page, then drop the flag so the same link works again.
  useEffect(() => {
    if (!apiReady || !openAccount) return
    // The timeout lets StrictMode cancel the first pass before it touches the store.
    const timer = window.setTimeout(() => {
      if (!openStoreAccount()) return
      document.getElementById(containerId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const params = new URLSearchParams(window.location.search)
      params.delete('account')
      const search = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [apiReady, openAccount, containerId])

  if (!storeId) {
    return (
      <p className="rounded-card border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        Online store unavailable — set <code>NEXT_PUBLIC_LIGHTSPEED_STORE_ID</code> in <code>.env.local</code>.
      </p>
    )
  }

  /*
   * Panel styling deliberately avoids backdrop-blur, transforms and
   * overflow-hidden: each would trap or clip the store's full-screen
   * pop-ups (product gallery, cart, dropdowns).
   */
  return (
    <div className={`rounded-panel border border-slate-100 bg-white p-4 shadow-glass sm:p-8 lg:p-10 ${className}`}>
      {/*
        The search box is in the site header (HeaderSearch). StoreSearch runs its
        searches in this store and shows a note here when one found nothing.
        StoreFilters is the Brand / Color / Finish / Type row.
      */}
      <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:mb-8 sm:flex-row sm:items-center sm:pb-8">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <StoreFilters ready={apiReady} />
          <StoreSearch ready={apiReady} resultsId={containerId} initialQuery={initialQuery} />
        </div>
        {showCart ? (
          // Ecwid draws the bag inside this div; it picks up the theme colours above.
          <div
            className="ec-cart-widget flex min-h-14 shrink-0 items-center justify-center sm:min-w-20"
            data-layout="MEDIUM_ICON_COUNTER"
            data-icon="BAG"
            data-fixed="FALSE"
            data-show-empty-cart="TRUE"
            data-show-buy-animation="TRUE"
            data-responsive="TRUE"
          />
        ) : null}
        {showAccount ? <StoreAccount ready={apiReady} resultsId={containerId} /> : null}
      </div>
      {loadFailed && !apiReady ? (
        <div role="alert" className="mb-6 rounded-card border border-brand-blue/20 bg-brand-mist p-6 text-center text-ink">
          <p className="text-lg font-semibold">The online store didn&rsquo;t load.</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            A browser extension may be blocking it, or it&rsquo;s briefly unavailable. Reload the page to try
            again, or call{' '}
            <a href="tel:7547011797" className="font-semibold text-brand-blue underline">
              (754) 701-1797
            </a>{' '}
            or email{' '}
            <a href="mailto:info@woodyspaper.com" className="font-semibold text-brand-blue underline">
              info@woodyspaper.com
            </a>{' '}
            for pricing and availability.
          </p>
        </div>
      ) : null}
      {/* min-h keeps the page from jumping while the storefront script loads. */}
      <div id={containerId} className="min-h-96 scroll-mt-chrome lg:scroll-mt-chrome-lg" />
    </div>
  )
}
