/*
 * Addresses of the site's own store pages, and the product list's state as it
 * is kept in the address bar:
 *
 *   /inventory?q=cups&category=206814148&brand=DIXIE,SOLO&color=WHITE&stock=1&sort=price-low&page=2
 *   /product?id=866392680
 *   /checkout
 *
 * Keeping the list's state in the address means a filtered view can be
 * bookmarked or shared, and Back returns to it. This file has no imports and
 * touches neither the page nor the network, so the tests run it directly.
 */

export const STORE_PATH = '/inventory'
export const PRODUCT_PATH = '/product'
export const CHECKOUT_PATH = '/checkout'
/** Opens the Lightspeed account page (orders, addresses) on the checkout page. */
export const STORE_ACCOUNT_PATH = `${CHECKOUT_PATH}?account=1`

/** Products per page of the list. */
export const PAGE_SIZE = 24

/**
 * One filter the list offers. `key` is the parameter Lightspeed's API takes;
 * `param` is its shorter name in our address.
 */
export type ProductFilter = { key: string; param: string; label: string }

/*
 * Every product has a Brand attribute and a UOM (unit of measure: each, case…)
 * option; most have COLOR and FINISH, a few TYPE. The store has no size field:
 * sizes are part of product names, so the search box finds them.
 */
export const PRODUCT_FILTERS: ProductFilter[] = [
  { key: 'attribute_Brand', param: 'brand', label: 'Brand' },
  { key: 'option_COLOR', param: 'color', label: 'Color' },
  { key: 'option_FINISH', param: 'finish', label: 'Finish' },
  { key: 'option_TYPE', param: 'type', label: 'Type' },
  { key: 'option_UOM', param: 'unit', label: 'Sold by' },
]

/** Ways to order the list. `api` is Lightspeed's sortBy value; '' leaves its own order (best match for a search). */
export const SORTS = [
  { value: 'relevance', label: 'Featured', api: '' },
  { value: 'name', label: 'Name A–Z', api: 'NAME_ASC' },
  { value: 'price-low', label: 'Price: low to high', api: 'PRICE_ASC' },
  { value: 'price-high', label: 'Price: high to low', api: 'PRICE_DESC' },
  { value: 'newest', label: 'Newest', api: 'ADDED_TIME_DESC' },
] as const

export type SortValue = (typeof SORTS)[number]['value']

/** What the product list is showing. */
export type ListQuery = {
  /** Search text; '' for none. */
  q: string
  /** Lightspeed category id; null for all products. */
  category: number | null
  /** Chosen values per filter, keyed by the filter's `key`. Filters with nothing chosen are left out. */
  filters: Record<string, string[]>
  /** Only products in stock. */
  inStock: boolean
  sort: SortValue
  /** 1-based. */
  page: number
}

export const EMPTY_QUERY: ListQuery = { q: '', category: null, filters: {}, inStock: false, sort: 'relevance', page: 1 }

/** Longest search text the site accepts, from the box or a ?q= link. */
export const MAX_QUERY_LENGTH = 100

const positiveInt = (text: string | null): number | null => {
  if (!text || !/^\d{1,12}$/.test(text)) return null
  const value = Number(text)
  return value > 0 ? value : null
}

/** A value holding a comma can't be told apart from two values, so it is never offered or accepted. */
const splitValues = (text: string | null) =>
  (text ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

/** Reads the list's state from the address (`?q=…&brand=…`). Anything unexpected falls back to the default. */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const filters: Record<string, string[]> = {}
  for (const filter of PRODUCT_FILTERS) {
    const values = splitValues(params.get(filter.param))
    if (values.length) filters[filter.key] = values
  }
  const sort = params.get('sort')
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    category: positiveInt(params.get('category')),
    filters,
    inStock: params.get('stock') === '1',
    sort: SORTS.some((entry) => entry.value === sort) ? (sort as SortValue) : 'relevance',
    page: positiveInt(params.get('page')) ?? 1,
  }
}

/** The address of the product list showing `query`. Defaults are left out, so plain views get plain addresses. */
export function listHref(query: Partial<ListQuery> = {}): string {
  const params = new URLSearchParams()
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.category) params.set('category', String(query.category))
  for (const filter of PRODUCT_FILTERS) {
    const values = query.filters?.[filter.key]
    if (values?.length) params.set(filter.param, values.join(','))
  }
  if (query.inStock) params.set('stock', '1')
  if (query.sort && query.sort !== 'relevance') params.set('sort', query.sort)
  if (query.page && query.page > 1) params.set('page', String(query.page))
  // Commas read better unescaped, and are safe in a query string.
  const search = params.toString().replace(/%2C/g, ',')
  return search ? `${STORE_PATH}?${search}` : STORE_PATH
}

export const productHref = (id: number) => `${PRODUCT_PATH}?id=${id}`

/** The parameters Lightspeed's product search takes for `query` (without paging or field lists). */
export function searchParams(query: ListQuery): Record<string, string> {
  const params: Record<string, string> = { enabled: 'true' }
  if (query.q) params.keyword = query.q
  if (query.category) {
    params.categories = String(query.category)
    params.includeProductsFromSubcategories = 'true'
  }
  for (const [key, values] of Object.entries(query.filters)) {
    if (values.length) params[key] = values.join(',')
  }
  if (query.inStock) params.inStock = 'true'
  return params
}

/** As searchParams, plus the page and order: what one page of the list asks for. */
export function pageParams(query: ListQuery): Record<string, string> {
  const params = searchParams(query)
  const sort = SORTS.find((entry) => entry.value === query.sort)?.api
  if (sort) params.sortBy = sort
  params.limit = String(PAGE_SIZE)
  params.offset = String((query.page - 1) * PAGE_SIZE)
  return params
}

/**
 * The same view as Lightspeed's filter-values call wants it. That call names
 * the stock setting differently from the product search (inventory=instock).
 */
export function facetParams(query: ListQuery): Record<string, string> {
  const { inStock, enabled, includeProductsFromSubcategories, ...rest } = searchParams(query)
  void enabled
  void includeProductsFromSubcategories
  return inStock ? { ...rest, inventory: 'instock' } : rest
}

/**
 * Links made for the old embedded store kept its page in the hash:
 * `/inventory#!/napkins/p/866396123`, `…/c/206814148`,
 * `#!/~/search/keyword=cups&attribute_Brand=DIXIE&inventory=instock`,
 * `#!/~/cart`. Returns where such a link should go now, or null when the hash
 * isn't one of those.
 */
export function legacyHref(hash: string): string | null {
  if (!hash.startsWith('#!')) return null
  const route = hash.replace(/^#!\/?/, '')

  const product = /(?:^|\/)p\/(\d+)/.exec(route)
  if (product) return productHref(Number(product[1]))
  const category = /(?:^|\/)c\/(\d+)/.exec(route)
  if (category) return listHref({ category: Number(category[1]) })

  if (route.startsWith('~/search')) {
    const old = new URLSearchParams(route.slice('~/search'.length).replace(/^\//, ''))
    const filters: Record<string, string[]> = {}
    for (const filter of PRODUCT_FILTERS) {
      const values = splitValues(old.get(filter.key))
      if (values.length) filters[filter.key] = values
    }
    return listHref({
      q: (old.get('keyword') ?? '').replace(/\*+$/, ''),
      category: positiveInt(old.get('categories')),
      filters,
      inStock: old.get('inventory') === 'instock',
    })
  }
  if (/^~\/(cart|checkout)/.test(route)) return CHECKOUT_PATH
  if (/^~\/(account|signin|signIn)/.test(route)) return STORE_ACCOUNT_PATH
  return STORE_PATH
}
