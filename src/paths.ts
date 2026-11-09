/** Inventory hub route. A query opens that search once the store is ready. */
export function inventoryPath(query?: string) {
  const trimmed = query?.trim().replace(/\s+/g, ' ')
  return trimmed ? `/inventory?q=${encodeURIComponent(trimmed)}` : '/inventory'
}
