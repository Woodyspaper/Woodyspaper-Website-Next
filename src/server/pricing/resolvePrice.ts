/*
 * The price one visitor pays for one variant. Pure rules: no database, no
 * network, no imports, so tests/resolvePrice.test.mjs can run them.
 * pricing/prices.ts loads what these rules need and calls them.
 *
 * The order, most specific first (the same as the header of
 * db/005_customers_pricing.sql):
 *   1. a price agreed with that one customer           (dbo.CustomerPrices)
 *   2. the customer's price list: their own, else      (dbo.PriceListItems)
 *      their group's. With quantity breaks, the line
 *      whose range holds the quantity being bought.
 *   3. the group's percent off the list price, unless  (dbo.CustomerGroups)
 *      the product is in a category the discount
 *      leaves out
 *   4. the list price                                  (dbo.ProductVariants)
 *
 * A variant with no list price is never sold, whatever else is on file for
 * it: the pages say "Call for price".
 *
 * Guests, and accounts not matched to a customer, pay the list price.
 *
 * Money. Prices are stored with up to 5 decimals, as Lightspeed holds them.
 * The sums are done in whole numbers (hundred-thousandths of a dollar), never
 * in fractions, and the result is rounded ONCE, at the end, to the nearest
 * cent with halves rounded up: $7.125 becomes $7.13. That cent amount is the
 * unit price; a line's total is the unit price times the quantity.
 */

export type PriceSource = 'customer' | 'priceList' | 'groupDiscount' | 'list'

/** One line of a price list for one variant: the price from minQty units up to maxQty (null = no upper end). */
export type PriceListLine = { minQty: number; maxQty: number | null; price: number }

export type PriceListInfo = {
  id: number
  /** Switched on in our database (dbo.PriceLists.IsActive). */
  isActive: boolean
  /** Lightspeed marks the book "In Store" (the shop counter). Whether that keeps it off the website is a setting. */
  inStoreOnly: boolean
}

/** What pricing needs to know about the customer. Null stands for a guest. */
export type PricingCustomer = {
  /** The price list set on the customer themself; it comes before the group's. */
  ownPriceList: PriceListInfo | null
  groupPriceList: PriceListInfo | null
  /** The group's percent off list price: 28 means they pay 72%. 0 when there is none. */
  discountPercent: number
  /** Categories the group's percent discount does not apply to. */
  excludedCategoryIds: readonly number[]
}

export type PricingOptions = {
  /** Apply price lists marked "In Store" on the website too. The site does (see pricingOptions in prices.ts). */
  applyInStoreLists: boolean
}

export type PricingVariant = {
  /** List price in dollars as stored; null, zero or less means it has none. */
  listPrice: number | null
  /** Every category the product is in. */
  categoryIds: readonly number[]
  /** The price agreed with this one customer, when there is one. */
  customerPrice?: number | null
  /** This variant's lines on the customer's price list (the list chosen by usablePriceList). */
  priceListLines?: readonly PriceListLine[]
}

export type ResolvedPrice =
  | { sellable: false; unitCents: null; listCents: null; source: null }
  | { sellable: true; unitCents: number; listCents: number; source: PriceSource }

const NOT_SOLD: ResolvedPrice = { sellable: false, unitCents: null, listCents: null, source: null }

/** Dollars with up to 5 decimals → whole hundred-thousandths of a dollar. Null when there is no usable amount. */
function toUnits(dollars: number | null | undefined): number | null {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) return null
  const units = Math.round(dollars * 100_000)
  return units > 0 && Number.isSafeInteger(units) ? units : null
}

/** Hundred-thousandths of a dollar → cents, halves rounded up. */
const unitsToCents = (units: number): number => Math.floor((units + 500) / 1000)

/** The exact stored price in cents, halves rounded up: 7.125 → 713. Null when there is no usable amount. */
export function toCents(dollars: number | null | undefined): number | null {
  const units = toUnits(dollars)
  return units == null ? null : unitsToCents(units)
}

/**
 * The list price less a percent, in cents, rounded once (halves up). The
 * percent is read to 3 decimals, as it is stored. Whole-number arithmetic
 * throughout, so 28% off $10.005 is exactly 720.36 cents → $7.20.
 */
function discountedCents(listUnits: number, percent: number): number {
  const keepThousandths = BigInt(100_000 - Math.round(percent * 1000))
  // listUnits is in 1/100,000 dollar and the share kept in 1/100,000: the
  // product is in 1/10,000,000,000 dollar, so one cent is 100,000,000 of them.
  const product = BigInt(listUnits) * keepThousandths
  const cent = BigInt(100_000_000)
  return Number((product + cent / BigInt(2)) / cent)
}

/**
 * The price list that applies to this customer on the website: their own if
 * it can be used, else their group's, else none. A list can be used when it
 * is switched on and, when "In Store" lists are being kept off the website,
 * is not one of those.
 */
export function usablePriceList(customer: PricingCustomer | null, options: PricingOptions): PriceListInfo | null {
  if (!customer) return null
  const usable = (list: PriceListInfo | null) => (list && list.isActive && (options.applyInStoreLists || !list.inStoreOnly) ? list : null)
  return usable(customer.ownPriceList) ?? usable(customer.groupPriceList)
}

/** A whole quantity of at least 1; anything unreadable counts as 1. */
function wholeQuantity(quantity: number): number {
  return Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1
}

/**
 * The price-list line for this quantity: among the lines whose range holds
 * the quantity, the one that starts highest. Null when no line covers it (for
 * example a list that only starts at 10 units and the buyer wants 3).
 */
export function priceListLineFor(lines: readonly PriceListLine[] | undefined, quantity: number): PriceListLine | null {
  const wanted = wholeQuantity(quantity)
  let best: PriceListLine | null = null
  for (const line of lines ?? []) {
    if (toUnits(line.price) == null) continue
    if (line.minQty > wanted || (line.maxQty != null && wanted > line.maxQty)) continue
    if (!best || line.minQty > best.minQty) best = line
  }
  return best
}

/**
 * The unit price for `quantity` units of one variant, in cents, and where it
 * came from. `customer` is null for a guest or an unmatched account.
 * `variant.priceListLines` must be the lines of the list usablePriceList chose.
 */
export function resolvePrice(customer: PricingCustomer | null, variant: PricingVariant, quantity = 1): ResolvedPrice {
  const listUnits = toUnits(variant.listPrice)
  if (listUnits == null) return NOT_SOLD
  const listCents = unitsToCents(listUnits)
  // A price under half a cent rounds to nothing; that is not a price.
  if (listCents <= 0) return NOT_SOLD
  const sold = (unitCents: number, source: PriceSource): ResolvedPrice => ({ sellable: true, unitCents, listCents, source })
  if (!customer) return sold(listCents, 'list')

  const agreed = toCents(variant.customerPrice)
  if (agreed) return sold(agreed, 'customer')

  const line = priceListLineFor(variant.priceListLines, quantity)
  const fromList = line ? toCents(line.price) : null
  if (fromList) return sold(fromList, 'priceList')

  const percent = customer.discountPercent
  if (Number.isFinite(percent) && percent > 0 && percent < 100) {
    const excluded = variant.categoryIds.some((id) => customer.excludedCategoryIds.includes(id))
    if (!excluded) {
      const cents = discountedCents(listUnits, percent)
      if (cents > 0) return sold(cents, 'groupDiscount')
    }
  }
  return sold(listCents, 'list')
}

/** 123456 → "$1,234.56". */
export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(cents % 100).padStart(2, '0')}`
}
