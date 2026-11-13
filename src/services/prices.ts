import { useEffect, useSyncExternalStore } from 'react'
import { api, useAccount } from './account'
import type { VisitorPrice } from './priceDisplay'

/*
 * The signed-in customer's own prices for the products on screen, from
 * POST /api/prices (which knows who is asking from the sign-in cookie).
 *
 * Only asked for when the account is matched to a customer. Guests, and
 * accounts with no customer pricing, never call the API and see the list
 * prices exactly as before.
 *
 * Cards ask one product at a time; the requests made in the same moment are
 * gathered into one call. Answers are remembered for this sign-in only: a
 * different account, or the same one gaining or losing its customer match,
 * starts again from nothing.
 */

/** One product's prices: its own (the default version's) and each version's. */
export type ProductPrices = VisitorPrice & { id: number; variations: (VisitorPrice & { id: number })[] }

/** The server takes at most this many products in one request. */
const BATCH = 60
/** Prices are asked for again after this long, so a page left open doesn't show old ones all day. */
const KEEP_MS = 15 * 60 * 1000

/** Whose prices are remembered ('' = nobody's). */
let owner = ''
let fetchedAt = 0
/** null = asked, and the server has no such product. */
const known = new Map<number, ProductPrices | null>()
const waiting = new Set<number>()
const asking = new Set<number>()
/** Asked and failed: not asked again until the sign-in changes or the prices expire. */
const failed = new Set<number>()
const listeners = new Set<() => void>()
let flush: ReturnType<typeof setTimeout> | undefined

function forget(nextOwner: string) {
  owner = nextOwner
  fetchedAt = 0
  known.clear()
  waiting.clear()
  asking.clear()
  failed.clear()
}

async function ask(ids: number[], askedFor: string) {
  ids.forEach((id) => asking.add(id))
  try {
    const answer = await api<{ products: ProductPrices[] }>('/api/prices', { productIds: ids })
    // The sign-in changed while we waited: these prices belong to someone else.
    if (owner !== askedFor) return
    if (!fetchedAt) fetchedAt = Date.now()
    const found = new Map(answer.products.map((product) => [product.id, product]))
    ids.forEach((id) => known.set(id, found.get(id) ?? null))
  } catch {
    // The pages fall back to the list price they already show.
    if (owner === askedFor) ids.forEach((id) => failed.add(id))
  } finally {
    if (owner === askedFor) ids.forEach((id) => asking.delete(id))
    listeners.forEach((listener) => listener())
  }
}

function want(id: number) {
  if (fetchedAt && Date.now() - fetchedAt > KEEP_MS) forget(owner)
  if (known.has(id) || waiting.has(id) || asking.has(id) || failed.has(id)) return
  waiting.add(id)
  // Wait a moment so every card drawn in this pass goes into the same request.
  flush ??= setTimeout(() => {
    flush = undefined
    const ids = [...waiting]
    waiting.clear()
    for (let start = 0; start < ids.length; start += BATCH) void ask(ids.slice(start, start + BATCH), owner)
  }, 0)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * This visitor's prices for one product (by its Lightspeed eCom id), or
 * undefined: they are a guest, have no customer pricing, the answer hasn't
 * arrived yet, or we don't hold the product. Undefined always means "show
 * the list price as usual".
 */
export function useProductPrices(productId: number): ProductPrices | undefined {
  const account = useAccount()
  const enabled = Boolean(account?.hasCustomerPricing) && productId > 0
  const key = enabled ? (account?.email ?? '') : ''

  useEffect(() => {
    if (owner !== key) forget(key)
    if (key) want(productId)
  }, [key, productId])

  const prices = useSyncExternalStore(
    subscribe,
    () => (key && owner === key ? known.get(productId) : undefined),
    () => undefined,
  )
  return prices ?? undefined
}
