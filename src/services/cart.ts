import { useSyncExternalStore } from 'react'
import { toCartLines } from './cartLines'
import type { CartLine } from './cartLines'
import { storeReady, storeScriptEnabled } from './storeScript'
import type { EcwidApi, EcwidCart, EcwidTotals } from './storeScript'

/*
 * The shopping cart shown in the site header.
 *
 * The cart itself is Lightspeed's: it lives in the store script
 * (storeScript.ts), which remembers it between visits and carries it into the
 * checkout, so stock, tax and a signed-in customer's pricing are always the
 * store's own. This file mirrors it for the site's pages and passes on
 * changes (add, change quantity, remove).
 */

export type { CartLine }

export type CartState = {
  /** False until the store has reported the cart; only `count` is known before that. */
  loaded: boolean
  /** The store couldn't be loaded (blocked or offline), so the cart can't be used. */
  failed: boolean
  /** The cart drawer is showing. */
  open: boolean
  /** Units in the cart, for the header badge. */
  count: number
  lines: CartLine[]
  /** Before tax and shipping, as the store formats it; '' until known. */
  subtotal: string
  /** A signed-in customer's account discount on this cart ("$12.40"), or ''. */
  discount: string
  /** The store's running total, after discounts. Tax and shipping are added at checkout once the address is known. */
  total: string
}

/** The count is remembered here so the badge is right before the store has loaded. */
const COUNT_KEY = 'woodys-cart-count'

function savedCount(): number {
  try {
    const value = Number(window.localStorage.getItem(COUNT_KEY))
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function saveCount(count: number) {
  try {
    if (count > 0) window.localStorage.setItem(COUNT_KEY, String(count))
    else window.localStorage.removeItem(COUNT_KEY)
  } catch {
    // Storage blocked: the badge just fills in once the store loads.
  }
}

const EMPTY: CartState = { loaded: false, failed: false, open: false, count: 0, lines: [], subtotal: '', discount: '', total: '' }

let state: CartState = EMPTY
const listeners = new Set<() => void>()

function publish(next: Partial<CartState>) {
  state = { ...state, ...next }
  saveCount(state.count)
  listeners.forEach((listener) => listener())
}

const money = (ecwid: EcwidApi, amount: number | undefined) =>
  typeof amount === 'number' ? (ecwid.formatCurrency?.(amount) ?? `$${amount.toFixed(2)}`) : ''

/*
 * A quantity the visitor has just chosen, per cart line, until the store
 * agrees. After a change the store's cart can briefly report the old number
 * again while it saves to its server; without this the line would flick back
 * and then forward a few seconds later.
 */
const chosenQuantity = new Map<string, { quantity: number; expires: number }>()
/** How long a chosen quantity is shown before the store's own number is believed again. */
const CHOSEN_HOLD_MS = 8000

const lineKey = (id: number, options: Record<string, string> | null | undefined) =>
  `${id}|${JSON.stringify(Object.entries(options ?? {}).sort())}`

/** Reads the store's cart and totals into `state`. */
function refresh(ecwid: EcwidApi, cart?: EcwidCart) {
  const apply = (current: EcwidCart) => {
    const now = Date.now()
    let holding = false
    const items = (current.items ?? []).map((item) => {
      const key = lineKey(item.product.id, item.options)
      const chosen = chosenQuantity.get(key)
      if (!chosen) return item
      // The store has caught up, or took too long: its number stands from here on.
      if (item.quantity === chosen.quantity || now > chosen.expires) {
        chosenQuantity.delete(key)
        return item
      }
      holding = true
      return { ...item, quantity: chosen.quantity }
    })
    const lines = toCartLines(items, (amount) => money(ecwid, amount))
    publish({ loaded: true, failed: false, lines, count: lines.reduce((sum, line) => sum + line.quantity, 0) })
    if (holding) {
      // The store's totals are still for the old quantity. With no discount in play the subtotal is simply the lines added up.
      if (!state.discount) {
        const sum = items.reduce((total, item) => total + (item.product.price ?? 0) * item.quantity, 0)
        publish({ subtotal: money(ecwid, sum), total: money(ecwid, sum) })
      }
      return
    }
    ecwid.Cart?.calculateTotal((order: EcwidTotals | null) => {
      if (!order) return
      const discount =
        (order.customerGroupDiscount ?? 0) + (order.customerGroupVolumeDiscount ?? 0) + (order.volumeDiscount ?? 0) + (order.couponDiscount ?? 0)
      publish({
        subtotal: money(ecwid, order.subtotal),
        discount: discount > 0 ? money(ecwid, discount) : '',
        total: money(ecwid, order.total),
      })
    })
  }
  if (cart?.items) apply(cart)
  else ecwid.Cart?.get(apply)
}

let started = false

/** Calls waiting to hear that the store's cart has changed (addToCart). Each is called once. */
const changeWaiters = new Set<() => void>()

/**
 * Loads the store in the background and starts following its cart. Safe to
 * call on every page; only the first call does anything.
 */
export function startCart() {
  if (started || !storeScriptEnabled) return
  started = true
  storeReady()
    .then((ecwid) => {
      // The store can't remove a listener, so this is added once per page view.
      ecwid.OnCartChanged?.add(() => {
        const waiting = [...changeWaiters]
        changeWaiters.clear()
        waiting.forEach((waiter) => waiter())
        refresh(ecwid)
      })
      refresh(ecwid)
    })
    .catch(() => {
      started = false
      publish({ failed: true })
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // First reader in the browser: show the remembered count while the store loads.
  if (state === EMPTY) state = { ...EMPTY, count: savedCount() }
  return () => {
    listeners.delete(listener)
  }
}

export function useCart(): CartState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  )
}

/** Opens or closes the cart drawer (components/CartDrawer.tsx). */
export const setCartOpen = (open: boolean) => publish({ open })

export type CartResult = { ok: true } | { ok: false; message: string }

const UNAVAILABLE = 'The cart isn’t available right now. Check your connection, or call (754) 701-1797 to order.'

/** How long the store may take to confirm a change before the visitor is told it failed. */
const CHANGE_TIMEOUT_MS = 15_000

/**
 * Adds a product to the cart. `options` are the buyer's choices by option
 * name, e.g. { UOM: 'CASE' }; leave it out for a product with nothing to choose.
 *
 * Resolves as soon as the store's cart shows the change, which is at once.
 * The store's own confirmation follows a few seconds later, after it has
 * saved the cart on its server; waiting for that made the button feel slow.
 */
export async function addToCart(id: number, quantity: number, options?: Record<string, string>): Promise<CartResult> {
  let ecwid: EcwidApi
  try {
    startCart()
    ecwid = await storeReady()
  } catch {
    return { ok: false, message: UNAVAILABLE }
  }
  const cart = ecwid.Cart
  if (!cart) return { ok: false, message: UNAVAILABLE }

  return new Promise<CartResult>((resolve) => {
    const finish = (result: CartResult) => {
      window.clearTimeout(timer)
      changeWaiters.delete(changed)
      resolve(result)
    }
    const changed = () => finish({ ok: true })
    const timer = window.setTimeout(() => finish({ ok: false, message: 'That took too long. Please try again.' }), CHANGE_TIMEOUT_MS)
    changeWaiters.add(changed)
    try {
      cart.addProduct({
        id,
        quantity,
        options,
        callback: (success) => {
          refresh(ecwid)
          finish(success ? { ok: true } : { ok: false, message: 'We couldn’t add that to your cart. It may have just sold out.' })
        },
      })
    } catch {
      finish({ ok: false, message: UNAVAILABLE })
    }
  })
}

/** Removes the cart line at `index` (its position in `lines`). */
export async function removeFromCart(index: number): Promise<void> {
  try {
    const ecwid = await storeReady()
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, CHANGE_TIMEOUT_MS)
      ecwid.Cart?.removeProduct(index, () => {
        window.clearTimeout(timer)
        resolve()
      })
    })
    refresh(ecwid)
  } catch {
    publish({ failed: true })
  }
}

/**
 * Changes how many of the line at `index` are in the cart; 0 removes it.
 * Resolves as soon as the store's cart shows the change, like addToCart.
 */
export async function setCartQuantity(index: number, quantity: number): Promise<CartResult> {
  const line = state.lines[index]
  if (!line || quantity === line.quantity) return { ok: true }
  if (quantity <= 0) {
    await removeFromCart(index)
    return { ok: true }
  }

  let ecwid: EcwidApi
  try {
    ecwid = await storeReady()
  } catch {
    return { ok: false, message: UNAVAILABLE }
  }
  const update = ecwid.Cart?.updateCartItem
  if (!update) {
    // A store script without the direct call: adding more still works. Taking
    // the line out and putting fewer back is NOT done, because the store can
    // lose the line when the two changes cross on their way to its server.
    if (quantity > line.quantity) return addToCart(line.id, quantity - line.quantity, line.options)
    return { ok: false, message: 'We couldn’t change the quantity here. You can change it at checkout.' }
  }

  return new Promise<CartResult>((resolve) => {
    const finish = (result: CartResult) => {
      window.clearTimeout(timer)
      changeWaiters.delete(changed)
      resolve(result)
    }
    const changed = () => finish({ ok: true })
    const timer = window.setTimeout(() => finish({ ok: false, message: 'That took too long. Please try again.' }), CHANGE_TIMEOUT_MS)
    changeWaiters.add(changed)
    // Show the new number at once, and keep showing it until the store agrees (see chosenQuantity).
    const key = lineKey(line.id, line.options)
    chosenQuantity.set(key, { quantity, expires: Date.now() + CHOSEN_HOLD_MS })
    refresh(ecwid)
    // If the store never reports the new number, go back to whatever it says.
    window.setTimeout(() => refresh(ecwid), CHOSEN_HOLD_MS + 100)
    try {
      update.call(ecwid.Cart, { index, quantity }, (success) => {
        // Refused (not that many in stock, say): drop the chosen number so the store's own shows.
        if (!success) chosenQuantity.delete(key)
        refresh(ecwid)
        finish(success ? { ok: true } : { ok: false, message: 'We couldn’t change that. There may not be that many in stock.' })
      })
    } catch {
      finish({ ok: false, message: UNAVAILABLE })
    }
  })
}
