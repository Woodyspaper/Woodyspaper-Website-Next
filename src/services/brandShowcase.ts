import { storeApiEnabled, storeApiGet } from './storeApi'
import { listHref, productHref } from './storeRoutes'

/*
 * The brands we stock, each with a few of its products, for the home page
 * carousel. Read from Lightspeed's (Ecwid) product API with the public token
 * (see storeApi.ts). Every product in the store has a Brand attribute; the
 * same one drives the Brand filter on /inventory (productFilters.ts).
 */

export type BrandProduct = {
  id: number
  name: string
  sku: string
  /** List price as the store formats it, e.g. "$41.27". */
  price: string
  image: string
  /** The product's page on this site. */
  href: string
}

export type Brand = {
  /** As the store spells it, e.g. "HAMMERMILL". */
  name: string
  /** Products of this brand in stock right now. */
  inStockCount: number
  /** The product list showing this brand's products in stock. */
  href: string
  products: BrandProduct[]
}

/** How many brands the carousel shows: the ones with the most products in stock. */
export const BRAND_LIMIT = 10
/** Products shown per brand. */
export const PRODUCTS_PER_BRAND = 4

/**
 * Brand values that aren't brands a customer would look for. Compared in
 * upper case.
 */
const NOT_A_BRAND = new Set(['GENERIC', 'REPORT', 'WHITELABEL', 'UNIVERSAL'])

type ApiFacets = {
  filters?: Record<string, { values?: { title?: string; productCount?: number }[] }>
}

type ApiProduct = {
  id: number
  name: string
  sku?: string
  price?: number
  defaultDisplayedPriceFormatted?: string
  thumbnailUrl?: string
}

const PRODUCT_FIELDS = 'items(id,name,sku,price,defaultDisplayedPriceFormatted,thumbnailUrl)'

/** Fit to show: a photo, a real price, and not marked discontinued. */
const showable = (product: ApiProduct) =>
  Boolean(product.thumbnailUrl && product.price && product.price > 0 && product.defaultDisplayedPriceFormatted) &&
  !/discontinued/i.test(product.name)

async function loadBrandProducts(brand: string): Promise<BrandProduct[]> {
  const data = await storeApiGet<{ items?: ApiProduct[] }>('products', {
    enabled: 'true',
    inStock: 'true',
    attribute_Brand: brand,
    // A few spare, in case some have no photo or price.
    limit: String(PRODUCTS_PER_BRAND * 3),
    responseFields: PRODUCT_FIELDS,
  })
  return (data.items ?? [])
    .filter(showable)
    .slice(0, PRODUCTS_PER_BRAND)
    .map((product) => ({
      id: product.id,
      name: product.name,
      // Lightspeed shows variants as "1005290 - Base"; the base SKU is what people know.
      sku: (product.sku ?? '').replace(/\s*-\s*Base$/i, ''),
      price: product.defaultDisplayedPriceFormatted ?? '',
      image: product.thumbnailUrl ?? '',
      href: productHref(product.id),
    }))
}

let request: Promise<Brand[]> | null = null

/**
 * The brands with the most products in stock, each with up to four of its
 * in-stock products, in the store's own order. Asked once per visit.
 *
 * Resolves to [] when the public token isn't set or no brand has anything
 * to show; the page then leaves the carousel out. Rejects when the store
 * couldn't be reached even after retrying (storeApi.ts); the page then says
 * so and offers to try again, which asks afresh.
 */
export function loadBrands(): Promise<Brand[]> {
  if (!storeApiEnabled) return Promise.resolve([])
  request ??= storeApiGet<ApiFacets>('products/filters', {
    enabled: 'true',
    inventory: 'instock',
    filterFields: 'attribute_Brand',
    // The API returns 10 values unless told otherwise.
    filterFacetLimit: 'attribute_Brand:300',
  })
    .then(async (data) => {
      const top = (data.filters?.attribute_Brand?.values ?? [])
        .filter(
          (entry) =>
            entry.title &&
            // A comma separates values in the list's address, so such a brand can't be linked to.
            !entry.title.includes(',') &&
            !NOT_A_BRAND.has(entry.title.toUpperCase()) &&
            (entry.productCount ?? 0) > 0,
        )
        .sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0))
        .slice(0, BRAND_LIMIT)

      const brands = await Promise.all(
        top.map(async (entry): Promise<Brand> => {
          const name = entry.title as string
          return {
            name,
            inStockCount: entry.productCount ?? 0,
            href: listHref({ filters: { attribute_Brand: [name] }, inStock: true }),
            // One brand failing to load shouldn't take the others down.
            products: await loadBrandProducts(name).catch(() => []),
          }
        }),
      )
      // A brand with nothing fit to show is skipped.
      return brands.filter((brand) => brand.products.length > 0)
    })
    .catch((error: unknown) => {
      request = null // the next call asks again
      throw error
    })
  return request
}
