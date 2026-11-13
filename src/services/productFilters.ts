import { storeApiEnabled, storeApiGet } from './storeApi'
import { PRODUCT_FILTERS } from './storeRoutes'

/*
 * The values each product filter can take (storeRoutes.ts lists the filters).
 *
 * Every product has a Brand attribute, and most have COLOR / FINISH options.
 * The product API filters by them (`attribute_Brand=…`, `option_COLOR=…`) and
 * can say which values exist, with counts, among the products on show; the
 * filter row (ProductFilters.tsx) is drawn from that.
 */

export type FilterValue = { value: string; count: number }

/** Values on offer per filter key, most products first. */
export type FilterFacets = Record<string, FilterValue[]>

export const filtersEnabled = storeApiEnabled

type ApiFacets = {
  filters?: Record<string, { values?: { title?: string; productCount?: number }[] }>
}

const FIELDS = PRODUCT_FILTERS.map((filter) => filter.key).join(',')
/** The API returns 10 values per filter unless told otherwise; brands and colors run to ~90. */
const FACET_LIMIT = PRODUCT_FILTERS.map((filter) => `${filter.key}:300`).join(',')

/** Recent answers, so toggling a filter back doesn't ask again. */
const cache = new Map<string, FilterFacets>()
const CACHE_SIZE = 40

/**
 * The values each filter can take among the products matching `context`: the
 * list's current view as API parameters (storeRoutes.facetParams). A filter's own choice
 * doesn't narrow its own list, so more values of it can be added.
 * Resolves to null when the public token isn't set.
 */
export async function loadFilterFacets(context: Record<string, string>, signal?: AbortSignal): Promise<FilterFacets | null> {
  if (!filtersEnabled) return null
  const params: Record<string, string> = {
    ...context,
    enabled: 'true', // without this the counts include products hidden from the store
    filterFields: FIELDS,
    filterFacetLimit: FACET_LIMIT,
  }
  if (params.categories) params.includeProductsFromSubcategories = 'true'
  // The store's prefix searches end in *; the API matches word starts by itself.
  if (params.keyword) params.keyword = params.keyword.replace(/\*+$/, '')

  const key = JSON.stringify(Object.entries(params).sort())
  const cached = cache.get(key)
  if (cached) return cached

  const data = await storeApiGet<ApiFacets>('products/filters', params, signal)
  const facets: FilterFacets = {}
  for (const { key: filterKey } of PRODUCT_FILTERS) {
    facets[filterKey] = (data.filters?.[filterKey]?.values ?? [])
      // A comma separates values in the list's address, so a value containing one can't be picked.
      .filter((entry) => entry.title && !entry.title.includes(',') && (entry.productCount ?? 0) > 0)
      .map((entry) => ({ value: entry.title as string, count: entry.productCount ?? 0 }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }

  cache.set(key, facets)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return facets
}
