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

/** Calls `listener` on every store page load. Call once the storefront API is ready. */
export function onStorePageLoaded(listener: (page: EcwidPage) => void) {
  hookEcwid()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
