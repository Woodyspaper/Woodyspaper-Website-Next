/*
 * What price a product card or product page shows. Pure rules (no imports),
 * so tests/priceDisplay.test.mjs can run them; services/prices.ts fetches
 * the visitor's prices and the components draw the result.
 */

/** A price as POST /api/prices returns it (src/server/pricing/prices.ts). */
export type VisitorPrice = {
  /** List price in dollars and as text ("$41.27"); null and '' when the product has no price. */
  listPrice: number | null
  listPriceFormatted: string
  /** What this visitor pays for one unit. */
  price: number | null
  priceFormatted: string
  /** Where their price came from; null when the product has no price. */
  source: 'customer' | 'priceList' | 'groupDiscount' | 'list' | null
  inStock: boolean
  quantity: number | null
  /** Quantity breaks on the customer's price list, lowest quantity first. */
  breaks?: { minQty: number; maxQty: number | null; price: number; priceFormatted: string }[]
}

export type ShownPrice = {
  /** The price to show large; '' means "Call for price". */
  price: string
  /** The list price to show struck through beside it; '' for none. */
  was: string
  /** Label the price "Your price". */
  yours: boolean
}

/**
 * `listText` is the list price the page already has ("$41.27", or '' when
 * the product has none). `mine` is this visitor's price for it, when they are
 * a matched customer and it has arrived.
 *
 * Guests, and anyone whose price is simply the list price, see exactly what
 * the page showed before. A customer whose price is lower sees it as "Your
 * price" with the list price struck through; one whose agreed price happens
 * to be above list sees their price, labelled, with nothing struck through.
 */
export function shownPrice(listText: string, mine: VisitorPrice | null | undefined): ShownPrice {
  const asBefore = { price: listText, was: '', yours: false }
  if (!mine || mine.price === null || mine.listPrice === null || mine.source === null || mine.source === 'list') return asBefore
  if (mine.price === mine.listPrice) return asBefore
  return { price: mine.priceFormatted, was: mine.price < mine.listPrice ? mine.listPriceFormatted : '', yours: true }
}
