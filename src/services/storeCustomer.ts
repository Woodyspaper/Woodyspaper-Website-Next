import { useSyncExternalStore } from 'react'

/**
 * The visitor's Lightspeed (Ecwid) customer account, as far as the site needs it.
 *
 * Sign-in itself happens inside the store: Lightspeed applies the customer's
 * group discounts and prices. The store only runs on /inventory, so the
 * signed-in name is cached here for the header on other pages. The cache is
 * just a label; the store stays the source of truth whenever it loads.
 */
export type StoreCustomer = {
  name: string
  email: string
}

/** Shape of Ecwid's customer object (only the fields used here). */
export type EcwidCustomer = {
  email?: string
  billingPerson?: { name?: string }
} | null

const STORAGE_KEY = 'woodys-store-customer'
const CHANGE_EVENT = 'woodys-store-customer-change'

/** Hub URL that opens the store's account page (sign-in form when signed out). */
export const ACCOUNT_PATH = '/inventory?account=1'

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function save(customer: EcwidCustomer) {
  const value: StoreCustomer | null = customer?.email
    ? { email: customer.email, name: customer.billingPerson?.name?.trim() ?? '' }
    : null
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode): the header just keeps saying "Sign In".
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange) // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Signed-in customer, or null. Always null on the server and first render. */
export function useStoreCustomer(): StoreCustomer | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  if (!raw) return null
  try {
    // Browser storage can hold anything (an older format, a hand edit), so check
    // the shape: a bad value means "signed out", never a crash.
    const value: unknown = JSON.parse(raw)
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as StoreCustomer).email === 'string' &&
      (value as StoreCustomer).email &&
      typeof (value as StoreCustomer).name === 'string'
    ) {
      return value as StoreCustomer
    }
    return null
  } catch {
    return null
  }
}

/**
 * Starts mirroring the store's sign-in state into the cache. Call once the
 * storefront API is ready. Ecwid can't remove a listener, so it's added once
 * per Ecwid instance.
 */
export function watchStoreCustomer() {
  const ecwid = window.Ecwid as (Window['Ecwid'] & { __woodysCustomerHook?: boolean }) | undefined
  if (!ecwid?.Customer) return
  ecwid.Customer.get(save)
  if (ecwid.OnSetProfile && !ecwid.__woodysCustomerHook) {
    ecwid.OnSetProfile.add(save)
    ecwid.__woodysCustomerHook = true
  }
}

/** Opens the store's account page (or its sign-in form). */
export function openStoreAccount() {
  try {
    window.Ecwid?.openPage?.('account')
    return true
  } catch {
    return false
  }
}

/** Signs the customer out of the store and clears the cached label. */
export function signOutOfStore() {
  const signOut = window.Ecwid?.Customer?.signOut
  if (signOut) signOut(() => save(null))
  else save(null)
}
