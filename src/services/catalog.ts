import { storeApiEnabled, storeApiGet } from './storeApi'
import { pageParams } from './storeRoutes'
import type { ListQuery } from './storeRoutes'

/*
 * The store's products, for the site's own product list (/inventory) and
 * product page (/product). Read from Lightspeed's (Ecwid) product API with the
 * public token (storeApi.ts).
 *
 * The pages only know the shapes below, not Lightspeed's. If the catalog later
 * comes from our own database, this file is the one to change.
 */

export const catalogEnabled = storeApiEnabled

/** A product as the list shows it. */
export type ProductCard = {
  id: number
  name: string
  sku: string
  /** List price as the store formats it ("$41.27"), or '' when the product has no price set. */
  price: string
  inStock: boolean
  /** Product photo, or '' when it has none. */
  image: string
  /**
   * The buyer has something to pick first (each or case, a color…), so the
   * card sends them to the product page instead of adding straight to the cart.
   */
  hasChoices: boolean
}

export type ProductPage = {
  total: number
  items: ProductCard[]
  /**
   * Set when the search as typed found nothing and a simpler form of it did
   * ("cups" → "cup"): the words these results are for.
   */
  searchedFor?: string
}

/** One thing to choose on a product, e.g. "UOM": EACH / CASE. */
export type ProductOption = { name: string; label: string; choices: string[] }

/** One buyable version of a product: a combination of option choices with its own SKU, price and stock. */
export type ProductVariation = {
  id: number
  /** Option name → chosen value. */
  options: Record<string, string>
  sku: string
  price: string
  inStock: boolean
  /** Units on hand, or null when the store doesn't count this one. */
  quantity: number | null
  image: string
}

export type ProductDetail = {
  id: number
  name: string
  sku: string
  brand: string
  /** The store's own description, as HTML. Sanitised before it is shown (ProductView). */
  descriptionHtml: string
  price: string
  inStock: boolean
  /** Large photos, main one first. Empty when the product has none. */
  images: string[]
  options: ProductOption[]
  variations: ProductVariation[]
  categoryId: number | null
}

type ApiOption = { name?: string; choices?: { text?: string }[] }

type ApiCombination = {
  id: number
  options?: { name?: string; value?: string }[]
  sku?: string
  defaultDisplayedPriceFormatted?: string
  inStock?: boolean
  unlimited?: boolean
  quantity?: number
  imageUrl?: string
  hdThumbnailUrl?: string
}

type ApiProduct = {
  id: number
  name?: string
  sku?: string
  price?: number
  defaultDisplayedPriceFormatted?: string
  inStock?: boolean
  thumbnailUrl?: string
  hdThumbnailUrl?: string
  imageUrl?: string
  description?: string
  options?: ApiOption[]
  combinations?: ApiCombination[]
  attributes?: { name?: string; value?: string }[]
  media?: { images?: { imageOriginalUrl?: string; image1500pxUrl?: string; image800pxUrl?: string }[] }
  defaultCategoryId?: number
  enabled?: boolean
}

/** Lightspeed shows variants as "1005290 - Base"; the base SKU is what people know. */
const cleanSku = (sku: string | undefined) => (sku ?? '').replace(/\s*-\s*Base$/i, '')

/** A product with no price set comes back as $0.00: shown as "Call for price", never as free. */
const priceText = (product: { price?: number; defaultDisplayedPriceFormatted?: string }) =>
  product.price && product.price > 0 ? (product.defaultDisplayedPriceFormatted ?? '') : ''

/** Option names are stored in capitals ("UOM", "COLOR"). */
const OPTION_LABELS: Record<string, string> = { UOM: 'Sold by', COLOR: 'Color', FINISH: 'Finish', TYPE: 'Type' }
const optionLabel = (name: string) => OPTION_LABELS[name] ?? name.charAt(0) + name.slice(1).toLowerCase()

/** Only what a card shows, which keeps a page of 24 to a few KB. */
const CARD_FIELDS =
  'total,items(id,name,sku,price,defaultDisplayedPriceFormatted,inStock,thumbnailUrl,hdThumbnailUrl,options(choices(text)),combinations(id))'

function toCard(product: ApiProduct): ProductCard {
  return {
    id: product.id,
    name: product.name ?? '',
    sku: cleanSku(product.sku),
    price: priceText(product),
    inStock: product.inStock !== false,
    image: product.hdThumbnailUrl || product.thumbnailUrl || '',
    hasChoices:
      (product.combinations?.length ?? 0) > 1 || (product.options ?? []).some((option) => (option.choices?.length ?? 0) > 1),
  }
}

/** "Hot Cups" → "hot cup", "boxes" → "box". Short words are left alone ("gas", "bus"). */
export const singularWords = (text: string) =>
  text
    .toLowerCase()
    .split(/s+/)
    .map((word) => (word.length > 3 ? word.replace(/(?<=[sxz]|ch|sh)es$|(?<![su])s$/, '') : word))
    .join(' ')

/** Recent pages, so Back and flipping between pages don't ask again. */
const pages = new Map<string, ProductPage>()
const PAGE_CACHE_SIZE = 30

/**
 * One page of the product list for `query`. Rejects when the store can't be
 * reached even after retrying (storeApi.ts), and with an AbortError when
 * `signal` is aborted (the visitor moved on).
 */
export async function loadProducts(query: ListQuery, signal?: AbortSignal): Promise<ProductPage> {
  const params = { ...pageParams(query), responseFields: CARD_FIELDS }
  const key = JSON.stringify(params)
  const cached = pages.get(key)
  if (cached) return cached

  const ask = (asked: Record<string, string>) => storeApiGet<{ total?: number; items?: ApiProduct[] }>('products', asked, signal)
  let data = await ask(params)
  let searchedFor: string | undefined
  // The store matches whole words and word starts, so "cups" misses "CUP". Nothing found: try the words without their plural endings.
  const singular = query.q ? singularWords(query.q) : ''
  if (!data.total && singular && singular !== query.q.toLowerCase()) {
    const second = await ask({ ...params, keyword: singular })
    if (second.total) {
      data = second
      searchedFor = singular
    }
  }
  const page: ProductPage = { total: data.total ?? 0, items: (data.items ?? []).map(toCard), searchedFor }

  pages.set(key, page)
  if (pages.size > PAGE_CACHE_SIZE) pages.delete(pages.keys().next().value as string)
  return page
}

const details = new Map<number, ProductDetail>()

/** Turns Lightspeed's product into ours. Exported for the tests. */
export function toDetail(product: ApiProduct): ProductDetail {
  const photos = (product.media?.images ?? [])
    .map((image) => image.image1500pxUrl || image.imageOriginalUrl || image.image800pxUrl || '')
    .filter(Boolean)
  const images = photos.length ? photos : product.imageUrl ? [product.imageUrl] : []
  const base = { price: priceText(product), inStock: product.inStock !== false }

  return {
    id: product.id,
    name: product.name ?? '',
    sku: cleanSku(product.sku),
    brand: product.attributes?.find((attribute) => attribute.name === 'Brand')?.value ?? '',
    descriptionHtml: product.description ?? '',
    ...base,
    images,
    options: (product.options ?? [])
      .map((option) => ({
        name: option.name ?? '',
        label: optionLabel(option.name ?? ''),
        choices: (option.choices ?? []).map((choice) => choice.text ?? '').filter(Boolean),
      }))
      .filter((option) => option.name && option.choices.length > 0),
    variations: (product.combinations ?? []).map((combination) => ({
      id: combination.id,
      options: Object.fromEntries((combination.options ?? []).map((option) => [option.name ?? '', option.value ?? ''])),
      sku: cleanSku(combination.sku),
      price: combination.defaultDisplayedPriceFormatted ?? base.price,
      inStock: combination.inStock !== false,
      quantity: combination.unlimited || typeof combination.quantity !== 'number' ? null : combination.quantity,
      image: combination.imageUrl || combination.hdThumbnailUrl || '',
    })),
    categoryId: product.defaultCategoryId ?? null,
  }
}

/**
 * One product, for its page. Resolves to null when there is no such product
 * (or it is hidden in the store). Rejects when the store can't be reached.
 */
export async function loadProduct(id: number, signal?: AbortSignal): Promise<ProductDetail | null> {
  const cached = details.get(id)
  if (cached) return cached
  let product: ApiProduct
  try {
    product = await storeApiGet<ApiProduct>(`products/${id}`, {}, signal)
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null
    throw error
  }
  if (product.enabled === false) return null
  const detail = toDetail(product)
  details.set(id, detail)
  return detail
}

/**
 * The variation matching the buyer's choices, or null when they haven't
 * picked everything yet or the store sells no such combination. A variation
 * that leaves an option out matches any choice of it.
 */
export function findVariation(product: ProductDetail, chosen: Record<string, string>): ProductVariation | null {
  if (product.options.some((option) => !chosen[option.name])) return null
  return (
    product.variations.find((variation) =>
      Object.entries(variation.options).every(([name, value]) => chosen[name] === value),
    ) ?? null
  )
}
