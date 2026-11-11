import type { EcwidPage } from '@/components/LightSpeedStore'

/*
 * Ecwid.OnPageLoaded can't remove a callback, so the site adds exactly one per
 * Ecwid instance and fans each page out to whichever components are listening.
 */
const listeners = new Set<(page: EcwidPage) => void>()

function hookEcwid() {
  const ecwid = window.Ecwid as (Window['Ecwid'] & { __woodysPageHook?: boolean }) | undefined
  if (!ecwid?.OnPageLoaded || ecwid.__woodysPageHook) return
  ecwid.OnPageLoaded.add((page) => listeners.forEach((listener) => listener(page)))
  ecwid.__woodysPageHook = true
}

/**
 * Calls `listener` on every store page load. The hook onto the store is made
 * by whichever caller runs once the storefront API is ready (StoreSearch);
 * listeners added earlier, like the category bar's, start hearing from then.
 */
export function onStorePageLoaded(listener: (page: EcwidPage) => void) {
  hookEcwid()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/*
 * Requests from the site chrome (header search, category bar) to the store on
 * the current page. The store's controller (StoreSearch) answers them. With no
 * store on the page nothing is listening, and the caller goes to /inventory
 * instead.
 */
export type StoreRequest =
  /** Run a full search; '' goes back to the store's front page. */
  | { kind: 'search'; query: string }
  /** Open a product, e.g. one picked from the search suggestions. */
  | { kind: 'product'; id: number; route: string }
  /** Open a category; id 0 (route '') is the store's front page. */
  | { kind: 'category'; id: number; route: string }

const requestHandlers = new Set<(request: StoreRequest) => void>()

/** Hands `request` to the store on this page. False when there isn't one. */
export function requestStorePage(request: StoreRequest): boolean {
  if (requestHandlers.size === 0) return false
  requestHandlers.forEach((handler) => handler(request))
  return true
}

export function onStoreRequest(handler: (request: StoreRequest) => void) {
  requestHandlers.add(handler)
  return () => {
    requestHandlers.delete(handler)
  }
}
