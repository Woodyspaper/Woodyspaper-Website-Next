'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ACCOUNT_PATH, openStoreAccount, watchStoreCustomer } from '@/services/storeCustomer'
import { onStorePageLoaded } from '@/services/storePages'
import type { EcwidCustomer } from '@/services/storeCustomer'
import { StoreAccount } from './StoreAccount'
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
    }
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
  /** Show the site-styled product search above the store. */
  showSearch?: boolean
  /** Search to open once the storefront API is ready. Comes from the page URL. */
  initialQuery?: string
  /** Show Lightspeed's shopping bag (item count, opens the cart) beside the search. */
  showCart?: boolean
  /** Show the customer account control (sign in / my account / sign out). */
  showAccount?: boolean
  /** Open the store's account page (sign-in form when signed out) once ready. */
  openAccount?: boolean
  /**
   * Makes this store a front window for another page (e.g. "/inventory"):
   * it shows the store's front page, and any click, search or sign-in takes
   * the visitor to that page with the same store page open.
   */
  hubPath?: string
  className?: string
}

export function LightSpeedStore({
  storeId = DEFAULT_STORE_ID,
  productsPerPage = 30,
  defaultCategoryId = 0,
  design = {},
  showSearch = true,
  showCart = true,
  showAccount = true,
  openAccount = false,
  initialQuery = '',
  hubPath,
  className = '',
}: LightSpeedStoreProps) {
  const router = useRouter()
  const leavingForHub = useRef(false)
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

    // openPage throws until OnAPILoaded, even after the function itself exists.
    // The timeout covers a storefront build that never replays that callback.
    let readyMarked = false
    let readyFallback = 0
    const markReady = () => {
      // OnAPILoaded can't be unsubscribed: ignore calls meant for an earlier mount.
      if (readyMarked || disposed) return
      readyMarked = true
      window.clearTimeout(readyFallback)
      initCartWidget()
      watchStoreCustomer()
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

  /*
   * Front-window mode (hubPath): the store stays on its front page here, and
   * everything else opens on the hub page.
   * - Links inside the store (categories, products, pagination) are caught
   *   before the store follows them, and opened on the hub instead: a normal
   *   history entry, so Back returns here.
   * - Anything else that changes the store's page (cart icon, Buy Now
   *   options, a hash in the URL) is caught once the store has moved, and the
   *   address is *replaced* with the hub, so Back doesn't land on a page that
   *   would bounce forward again.
   */
  useEffect(() => {
    if (!apiReady || !hubPath) return
    leavingForHub.current = false
    let unlock = 0
    const go = (target: string, replace = false) => {
      if (leavingForHub.current) return
      leavingForHub.current = true
      // If the navigation gets cancelled (the store's own URL changes can do
      // that), don't leave the store ignoring clicks forever.
      unlock = window.setTimeout(() => {
        leavingForHub.current = false
      }, 3000)
      if (replace) router.replace(target)
      else router.push(target)
    }

    const container = document.getElementById(containerId)
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="#!/"]')
      if (!link) return
      event.preventDefault()
      event.stopPropagation()
      const target = hubPath + link.getAttribute('href')
      // Ctrl/Cmd/Shift-click: open the hub page in a new tab, as visitors expect.
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        window.open(target, '_blank', 'noopener')
        return
      }
      go(target)
    }
    container?.addEventListener('click', onClick, true)

    const stopListening = onStorePageLoaded((page) => {
      if (page.type === 'CATEGORY' && !page.categoryId) return // the front page
      if (page.type === 'SEARCH' && page.keywords) {
        go(`${hubPath}?q=${encodeURIComponent(page.keywords)}`, true)
        return
      }
      const { hash } = window.location
      go(hash.startsWith('#!/') ? hubPath + hash : hubPath, true)
    })

    return () => {
      window.clearTimeout(unlock)
      container?.removeEventListener('click', onClick, true)
      stopListening()
    }
  }, [apiReady, hubPath, containerId, router])

  // "Sign In" / "My Account" links elsewhere on the site arrive as ?account=1.
  // Open the account page, then drop the flag so the same link works again.
  useEffect(() => {
    if (!apiReady || !openAccount || hubPath) return
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
  }, [apiReady, openAccount, containerId, hubPath])

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
      {showSearch || showCart || showAccount ? (
        <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:mb-8 sm:flex-row sm:items-center sm:pb-8">
          {showSearch ? (
            <div className="flex-1">
              <StoreSearch ready={apiReady} resultsId={containerId} initialQuery={initialQuery} searchPath={hubPath} unavailable={loadFailed && !apiReady} />
            </div>
          ) : null}
          {showCart ? (
            // Ecwid draws the bag inside this div; it picks up the theme colours above.
            <div
              className="ec-cart-widget flex min-h-14 shrink-0 items-center justify-center sm:ml-auto sm:min-w-20"
              data-layout="MEDIUM_ICON_COUNTER"
              data-icon="BAG"
              data-fixed="FALSE"
              data-show-empty-cart="TRUE"
              data-show-buy-animation="TRUE"
              data-responsive="TRUE"
            />
          ) : null}
          {showAccount ? (
            <StoreAccount
              ready={apiReady}
              resultsId={containerId}
              accountHref={hubPath ? ACCOUNT_PATH : undefined}
            />
          ) : null}
        </div>
      ) : null}
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
