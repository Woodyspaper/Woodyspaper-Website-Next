import { storeApiEnabled, storeApiGet } from './storeApi'
import { listHref } from './storeRoutes'

/** A top-level store category, for the bar under the header. */
export type StoreCategory = {
  id: number
  /** Display name, e.g. "Food Handling" (the store keeps them in capitals). */
  name: string
  /** The product list showing this category. */
  href: string
}

type ApiCategory = {
  id: number
  name: string
  enabled?: boolean
  productCount?: number
}

/**
 * Categories kept in Lightspeed but not shown on the site.
 */
const HIDDEN_CATEGORY_IDS = new Set([
  206814161, // "FOOD HANDLIING", a misspelt duplicate of Food Handling
])

/** "FINE ART PAPER & STATIONERY" → "Fine Art Paper & Stationery". */
const titleCase = (name: string) =>
  name.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())

let request: Promise<StoreCategory[]> | null = null

/**
 * The store's top-level categories that have products, in store order. Asked
 * once per visit. Resolves to [] when the public token isn't set.
 */
export function loadCategories(): Promise<StoreCategory[]> {
  if (!storeApiEnabled) return Promise.resolve([])
  request ??= storeApiGet<{ items?: ApiCategory[] }>('categories', {
    parent: '0',
    limit: '100',
    responseFields: 'items(id,name,enabled,productCount)',
  })
    .then((data) =>
      (data.items ?? [])
        .filter(
          (category) =>
            category.enabled !== false && (category.productCount ?? 0) > 0 && !HIDDEN_CATEGORY_IDS.has(category.id),
        )
        .map((category) => ({
          id: category.id,
          name: titleCase(category.name),
          href: listHref({ category: category.id }),
        })),
    )
    .catch((error: unknown) => {
      request = null // let the next page view try again
      throw error
    })
  return request
}

let sizeRequest: Promise<number | null> | null = null

/**
 * How many products the store lists, for the home page ("1,100+ products").
 * Asked once per visit. Null when the public token isn't set or the store
 * can't be reached: the page then just leaves the number out.
 */
export function loadCatalogSize(): Promise<number | null> {
  if (!storeApiEnabled) return Promise.resolve(null)
  sizeRequest ??= storeApiGet<{ total?: number }>('products', { enabled: 'true', limit: '1', responseFields: 'total' })
    .then((data) => (typeof data.total === 'number' && data.total > 0 ? data.total : null))
    .catch(() => {
      sizeRequest = null
      return null
    })
  return sizeRequest
}
