import { api, hasStoreSsoHint, takePendingStoreSignOut } from './account'
import { signOutOfStore, watchStoreCustomer } from './storeCustomer'
import type { EcwidCustomer } from './storeCustomer'

/*
 * Lightspeed's (Ecwid) storefront script, loaded once per page view.
 *
 * The site draws its own product pages; the script is here for the parts that
 * stay Lightspeed's: the cart (services/cart.ts), the customer's store
 * sign-in, and the checkout itself (components/StoreCheckout.tsx). On every
 * page except /checkout it runs with nothing to draw.
 *
 * Docs:
 *  - Dynamic loading: https://docs.ecwid.com/api-reference/rest-api/storefront-widget-details/dynamic-loading-for-storefront-widget
 *  - Cart API:        https://docs.ecwid.com/storefronts/manage-cart-and-checkout
 */

export type EcwidWidget = {
  widgetType: 'ProductBrowser'
  id: string
  arg: string[]
}

/** The subset of Ecwid's page object the site uses. */
export type EcwidPage = { type: string; productId?: number; categoryId?: number }

/** One line of Ecwid's cart. */
export type EcwidCartItem = {
  quantity: number
  options?: Record<string, string>
  product: {
    id: number
    name?: string
    sku?: string
    price?: number
    /** Photo URLs at several sizes; the names vary, so cart.ts takes the first it finds. */
    mediaItem?: Record<string, unknown> | null
  }
}

export type EcwidCart = { items?: EcwidCartItem[]; productsQuantity?: number }

export type EcwidTotals = {
  subtotal?: number
  total?: number
  discount?: number
  couponDiscount?: number
  volumeDiscount?: number
  customerGroupDiscount?: number
  customerGroupVolumeDiscount?: number
}

type ChameleonTheme = {
  colors: Record<'color-background' | 'color-foreground' | 'color-link' | 'color-button' | 'color-price', string>
  font: { 'font-family': string }
}

type EcwidEvent<T> = { add: (callback: (value: T) => void) => void }

export type EcwidApi = {
  destroy: () => void
  init?: () => void
  refreshConfig?: () => void
  openPage?: (page: string, params?: Record<string, unknown>) => void
  formatCurrency?: (amount: number) => string
  OnAPILoaded?: EcwidEvent<void>
  OnPageLoaded?: EcwidEvent<EcwidPage>
  OnCartChanged?: EcwidEvent<EcwidCart>
  OnOrderPlaced?: EcwidEvent<unknown>
  OnSetProfile?: EcwidEvent<EcwidCustomer>
  Customer?: {
    get: (callback: (customer: EcwidCustomer) => void) => void
    signOut?: (callback?: () => void) => void
  }
  Cart?: {
    get: (callback: (cart: EcwidCart) => void) => void
    addProduct: (product: {
      id: number
      quantity: number
      options?: Record<string, string>
      callback?: (success: boolean, product: unknown, cart: EcwidCart | null, error?: unknown) => void
    }) => void
    removeProduct: (index: number, callback?: () => void) => void
    /** Sets how many of the line at `index` are in the cart. Not in Ecwid's written docs; checked against the live script. */
    updateCartItem?: (item: { index: number; quantity: number }, callback?: (success: boolean) => void) => void
    clear: (callback?: () => void) => void
    calculateTotal: (callback: (order: EcwidTotals | null) => void) => void
  }
  /** Single sign-on: signs the store in ('' signs out). Only works if ecwid_sso_profile was defined at load. */
  setSsoProfile?: (payload: string) => void
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
    Ecwid?: EcwidApi
    /** Defined (even as '') puts the store in single sign-on mode and hides its own sign-in links. */
    ecwid_sso_profile?: string
    /** Set by this site once the store script was started in single sign-on mode. */
    __woodysStoreSso?: boolean
    ecwid_onBodyDone?: () => void
  }
}

/** Public store ID — it appears in the page source regardless, so it's not a secret. */
export const STORE_ID = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID ?? ''
export const storeScriptEnabled = Boolean(STORE_ID)

const SCRIPT_ID = 'ecwid-script'
/** Automatic second tries at loading the script before giving up. */
const SCRIPT_RETRIES = 2
const SCRIPT_RETRY_MS = 1500
/** How long the store may take to become usable. */
const READY_TIMEOUT_MS = 30_000

/** Reads a design token from globals.css so the checkout tracks the site theme. */
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** Ecwid's colour + font settings, derived from the site's @theme tokens. */
function siteTheme(): ChameleonTheme {
  const blue = token('--color-brand-blue', '#0070bb')
  return {
    colors: {
      'color-background': '#ffffff',
      'color-foreground': token('--color-ink', '#172235'),
      'color-link': blue,
      'color-button': blue,
      'color-price': blue,
    },
    font: { 'font-family': token('--font-sans', "'Inter', sans-serif") },
  }
}

function appendScript(attempt = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.charset = 'utf-8'
    script.dataset.cfasync = 'false'
    script.src = `https://app.business.shop/script.js?${STORE_ID}&data_platform=code`
    script.onload = () => resolve()
    script.onerror = () => {
      // Blocked or offline. Remove the tag so it can be loaded afresh.
      script.remove()
      if (attempt >= SCRIPT_RETRIES) return reject(new Error('The store script could not be loaded.'))
      // A blip often passes: try again before giving up.
      window.setTimeout(() => appendScript(attempt + 1).then(resolve, reject), SCRIPT_RETRY_MS)
    }
    document.body.appendChild(script)
  })
}

/** Resolves once the storefront API accepts calls. */
function whenApiLoaded(): Promise<EcwidApi> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled || !window.Ecwid) return
      settled = true
      window.clearInterval(poll)
      window.clearTimeout(giveUp)
      resolve(window.Ecwid)
    }
    // Calls throw until OnAPILoaded, even once the functions exist. The short
    // timeout covers a storefront build that never replays that callback.
    const poll = window.setInterval(() => {
      const ecwid = window.Ecwid
      if (typeof ecwid?.openPage !== 'function') return
      window.clearInterval(poll)
      if (ecwid.OnAPILoaded) {
        ecwid.OnAPILoaded.add(finish)
        window.setTimeout(finish, 4000)
      } else {
        finish()
      }
    }, 250)
    const giveUp = window.setTimeout(() => {
      window.clearInterval(poll)
      if (settled) return
      settled = true
      // Loaded but never started: let the next page view retry from scratch.
      if (!window.Ecwid) document.getElementById(SCRIPT_ID)?.remove()
      reject(new Error('The store did not start.'))
    }, READY_TIMEOUT_MS)
  })
}

let ready: Promise<EcwidApi> | null = null

/**
 * Loads the store script (first call only) and resolves once its API is
 * usable. Rejects when the script is blocked or the store never starts; the
 * next call then tries again.
 *
 * To have the store draw something (the checkout page does), set
 * `window._xnext_initialization_scripts` before the first call.
 */
export function storeReady(): Promise<EcwidApi> {
  if (!storeScriptEnabled) return Promise.reject(new Error('NEXT_PUBLIC_LIGHTSPEED_STORE_ID is not set.'))
  ready ??= start().catch((error: unknown) => {
    ready = null
    throw error
  })
  return ready
}

/** True once the script has been asked for in this page view. */
export const storeScriptStarted = () => Boolean(document.getElementById(SCRIPT_ID))

async function start(): Promise<EcwidApi> {
  window.ec = window.ec || {}
  window.ec.config = { ...window.ec.config, chameleon: siteTheme() }
  window.ecwid_script_defer = true
  window.ecwid_dynamic_widgets = true
  window._xnext_initialization_scripts ??= []

  /*
   * Single sign-on, only for customers whose store account was created
   * through the website (src/server/lightspeed.ts). The store reads
   * ecwid_sso_profile when its script loads, so the sign-on string is fetched
   * first. Everyone else skips this and the store starts with its own sign-in.
   */
  let ssoEnded = false
  if (hasStoreSsoHint()) {
    try {
      const { payload } = await api<{ payload: string | null }>('/api/lightspeed/sso')
      if (payload) {
        window.ecwid_sso_profile = payload
        window.__woodysStoreSso = true
      } else {
        // Their website session ended without a sign-out (it expired, or was
        // ended from another browser): the store's sign-in ends with it.
        ssoEnded = true
      }
    } catch {
      // Server unreachable: the store opens signed out.
    }
  }

  await appendScript()
  const ecwid = await whenApiLoaded()
  watchStoreCustomer()
  // They signed out of the website since the store last ran: the store's
  // remembered sign-in (made by the website) goes too.
  if (takePendingStoreSignOut() || ssoEnded) signOutOfStore()
  return ecwid
}

/**
 * True when this visitor should be signed in to the store by the website but
 * the script already started without it (they signed in after it loaded). The
 * store can't switch modes, so the caller reloads the page where it matters.
 */
export const storeNeedsSsoRestart = () => storeScriptStarted() && hasStoreSsoHint() && !window.__woodysStoreSso
