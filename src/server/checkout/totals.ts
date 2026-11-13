/*
 * The money rules of the checkout: which delivery choices a customer may
 * pick, and the subtotal, delivery charge, sales tax and total of an order.
 * No imports and no database: the caller hands in the cart lines already
 * priced (by the pricing rules) and the store's settings, so the same code
 * runs on the server and in the tests.
 *
 * All results are whole cents. Nothing here uses fractions of a cent in a
 * result, and nothing uses floating-point arithmetic on money.
 *
 * ROUNDING RULES
 *   1. A unit price is before tax and may have up to 5 decimals, because
 *      that is how Lightspeed holds it (the register's prices are entered
 *      with tax included, so $257.10 at 7% is kept as $240.28037).
 *   2. Line total = unit price x quantity, rounded to the nearest cent, a
 *      half cent rounding up.
 *   3. Subtotal = the sum of the line totals.
 *   4. Sales tax is worked out ONCE, on the whole taxable amount of the
 *      order (taxable lines, plus the delivery charge when the store taxes
 *      delivery), and rounded to the nearest cent, a half cent rounding up.
 *      It is not rounded line by line, so the customer can check it with a
 *      calculator: taxable amount x rate.
 *   5. That tax is then shared out over the lines to the cent (each line's
 *      own share rounded down, the leftover cents going to the lines that
 *      lost the most), so the line taxes always add up to the order's tax.
 *      Lightspeed Retail needs a tax figure per line.
 *   6. Total = subtotal + delivery + tax.
 *
 * WHICH TAX RATE
 *   A signed-in customer is charged the tax set on their own account in
 *   Lightspeed Retail (their county's rate, or the 0% "Florida Resellers Tax
 *   Exempt Certificate Holder" tax). A guest, or a customer with no tax set,
 *   is charged the store's own rate. The caller hands the customer's tax in
 *   as `tax`; nothing here decides who the customer is.
 */

export type DeliveryMethod = 'pickup' | 'local' | 'ups'

export interface TotalsLine {
  /** Price of one, before tax, in dollars: "240.28037" or 12.5. Up to 5 decimals. */
  unitPrice: string | number
  /** A whole number, 1 or more. */
  quantity: number
  /** False for goods that are never taxed. */
  taxable: boolean
  /** Shipping weight of one, in pounds; null or missing when we don't hold it. */
  weightLb?: number | null
}

/**
 * The sales tax on a customer's account in Lightspeed Retail, as the
 * customer loader supplies it.
 */
export interface OrderTax {
  /** The rate as a percent: 7 or "6.5". Null when the account has no rate of its own. */
  taxRatePercent: string | number | null
  /** That tax's id in Lightspeed Retail, so the sale is recorded under the same tax. */
  retailTaxId: string | null
  /** True for a tax-exempt customer (a resale certificate holder): no sales tax at all. */
  exempt: boolean
}

export interface TotalsSettings {
  /** The store's own sales tax rate as a percent: 7 or "6.5". Up to 4 decimals. Used for guests and for customers with no tax on their account. */
  taxRatePercent: string | number
  /** ZIP codes we deliver to ourselves. */
  localZips: readonly string[]
  /** Smallest subtotal, in cents, that qualifies for local delivery. */
  localDeliveryMinimumCents: number
  /** What local delivery costs, in cents. 0 = free. */
  localDeliveryFeeCents: number
  /** Whether sales tax is charged on the delivery charge. The owner's decision: yes. */
  deliveryTaxable: boolean
}

/** The owner's rules until told otherwise: $200 minimum, free local delivery. */
export const DEFAULT_LOCAL_DELIVERY_MINIMUM_CENTS = 20000
export const DEFAULT_LOCAL_DELIVERY_FEE_CENTS = 0
/** The store's own rate: Broward County, 7%. */
export const DEFAULT_TAX_RATE_PERCENT = '7'

/**
 * The checkout's settings from .env.local (see README): the store's tax
 * rate, the local delivery ZIP list, minimum and fee, and whether delivery
 * is taxed (yes unless DELIVERY_TAXABLE=false). Amounts are in dollars.
 * A setting that can't be read is left as it was typed where the totals
 * will refuse it, rather than quietly replaced.
 */
export function totalsSettingsFromEnv(env: Record<string, string | undefined> = process.env): TotalsSettings {
  const value = (name: string) => env[name]?.trim() || ''
  const cents = (name: string, fallback: number) => {
    const text = value(name)
    if (!text) return fallback
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text)
    return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : Number.NaN
  }
  return {
    taxRatePercent: value('SALES_TAX_RATE_PERCENT') || DEFAULT_TAX_RATE_PERCENT,
    localZips: value('LOCAL_DELIVERY_ZIPS').split(/[\s,;]+/).filter(Boolean),
    localDeliveryMinimumCents: cents('LOCAL_DELIVERY_MINIMUM', DEFAULT_LOCAL_DELIVERY_MINIMUM_CENTS),
    localDeliveryFeeCents: cents('LOCAL_DELIVERY_FEE', DEFAULT_LOCAL_DELIVERY_FEE_CENTS),
    deliveryTaxable: !/^(false|no|0|off)$/i.test(value('DELIVERY_TAXABLE')),
  }
}

/**
 * What we know about UPS for this order: a rate from UPS in cents, a reason
 * it can't be used (UPS could not rate the address, say), or null when no
 * rate has been asked for yet.
 */
export type UpsQuote = { rateCents: number } | { unavailable: string } | null

export interface TotalsInput {
  lines: readonly TotalsLine[]
  /** The customer's choice; null while they have not chosen. */
  delivery: DeliveryMethod | null
  /** Where the order is going. Not needed for pickup. */
  destinationZip?: string | null
  ups?: UpsQuote
  /** The tax on the customer's account; null or left out for a guest (the store's rate applies). */
  tax?: OrderTax | null
  settings: TotalsSettings
}

export interface DeliveryOption {
  method: DeliveryMethod
  label: string
  available: boolean
  /** Why it can't be chosen, in words for the customer. Null when available. */
  reason: string | null
  /** What it costs in cents; null when not available, or for UPS before a rate is known. */
  chargeCents: number | null
}

export interface Totals {
  ok: true
  /** One entry per cart line, in the same order. */
  lines: { lineTotalCents: number; taxCents: number }[]
  options: DeliveryOption[]
  delivery: DeliveryMethod | null
  subtotalCents: number
  /** 0 until a delivery choice with a known charge is made. */
  deliveryCents: number
  /** The part of deliveryCents' tax; 0 unless the store taxes delivery. */
  deliveryTaxCents: number
  /**
   * The tax this order was charged under, to keep on the order and to send
   * to Lightspeed Retail: the rate actually used ("7", "6.5", "0"), the
   * customer's tax id when they have one (null = the store's default tax),
   * and whether the customer is exempt.
   */
  tax: { taxRatePercent: string; retailTaxId: string | null; exempt: boolean }
  /** The amount tax was worked out on. */
  taxableCents: number
  taxCents: number
  totalCents: number
  /** Total shipping weight in pounds; null when any line has no weight. */
  totalWeightLb: number | null
}

/** The order can't be totalled; `error` is safe to show the customer. */
export interface TotalsProblem {
  ok: false
  error: string
}

const MAX_UNIT_PRICE_E5 = 1e11 // $1,000,000 a unit
const MAX_QUANTITY = 10000
const MAX_ORDER_CENTS = 1e9 // $10,000,000

/** "12.5" -> 1250000 (hundred-thousandths of a dollar), exactly. Null when not a plain amount. */
function toE5(value: string | number): number | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(5) : '') : value.trim()
  const match = /^(\d{1,9})(?:\.(\d{1,5}))?$/.exec(text)
  if (!match) return null
  return Number(match[1]) * 100000 + Number((match[2] ?? '').padEnd(5, '0'))
}

/** A percent with up to 4 decimals -> ten-thousandths of a percent. Null when not a rate from 0 to 100. */
function rateToE4(value: string | number): number | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(4) : '') : value.trim()
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text)
  if (!match) return null
  const rate = Number(match[1]) * 10000 + Number((match[2] ?? '').padEnd(4, '0'))
  return rate <= 1000000 ? rate : null
}

/** 70000 -> "7", 65000 -> "6.5" */
function rateText(rateE4: number): string {
  const whole = Math.floor(rateE4 / 10000)
  const decimals = String(rateE4 % 10000).padStart(4, '0').replace(/0+$/, '')
  return decimals ? `${whole}.${decimals}` : String(whole)
}

/** Whole-number division, a half rounding up. Both numbers are whole and not negative. */
function divideRoundHalfUp(amount: number, divisor: number): number {
  const whole = Math.floor(amount / divisor)
  return (amount - whole * divisor) * 2 >= divisor ? whole + 1 : whole
}

const isCents = (value: number) => Number.isSafeInteger(value) && value >= 0

/** "$1,234.50" for messages. */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${dollars}.${String(cents % 100).padStart(2, '0')}`
}

/** The 5-digit ZIP of "33312", "33312-1234" or " 33312 "; null for anything else. */
export function normalizeZip(zip: string | null | undefined): string | null {
  const match = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(zip ?? '')
  return match ? match[1] : null
}

/**
 * The three delivery choices for an order of this size going to this ZIP,
 * each either available with its charge or not available with the reason.
 */
export function deliveryOptions(input: {
  subtotalCents: number
  destinationZip?: string | null
  ups?: UpsQuote
  /** False when some line has no shipping weight, so UPS can't price the order. */
  allLinesHaveWeight: boolean
  settings: Pick<TotalsSettings, 'localZips' | 'localDeliveryMinimumCents' | 'localDeliveryFeeCents'>
}): DeliveryOption[] {
  const { subtotalCents, settings } = input
  const zip = normalizeZip(input.destinationZip)
  const localZips = new Set(settings.localZips.map((z) => normalizeZip(z)).filter((z) => z != null))

  const option = (method: DeliveryMethod, label: string, reason: string | null, chargeCents: number | null): DeliveryOption =>
    reason == null ? { method, label, available: true, reason: null, chargeCents } : { method, label, available: false, reason, chargeCents: null }

  let localReason: string | null = null
  if (localZips.size === 0) {
    localReason = 'Local delivery is not available yet. Choose warehouse pickup or UPS shipping.'
  } else if (subtotalCents < settings.localDeliveryMinimumCents) {
    const short = settings.localDeliveryMinimumCents - subtotalCents
    localReason = `Local delivery is for orders of ${formatCents(settings.localDeliveryMinimumCents)} or more. Add ${formatCents(short)} more to qualify.`
  } else if (zip == null) {
    localReason = 'Enter your delivery ZIP code to see if we deliver to you.'
  } else if (!localZips.has(zip)) {
    localReason = `We don't deliver locally to ZIP code ${zip}. Choose UPS shipping or warehouse pickup.`
  }

  let upsReason: string | null = null
  let upsCharge: number | null = null
  if (!input.allLinesHaveWeight) {
    upsReason = 'Something in this order can’t be shipped by UPS yet. Choose warehouse pickup, or local delivery where we offer it.'
  } else if (zip == null) {
    upsReason = 'Enter your delivery ZIP code to get a UPS rate.'
  } else if (input.ups && 'unavailable' in input.ups) {
    upsReason = input.ups.unavailable
  } else if (input.ups) {
    upsCharge = input.ups.rateCents
  }

  return [
    option('pickup', 'Warehouse pickup', null, 0),
    option('local', 'Local delivery', localReason, settings.localDeliveryFeeCents),
    option('ups', 'UPS shipping', upsReason, upsCharge),
  ]
}

/** Subtotal, delivery choices, delivery charge, tax and total for a cart. */
export function computeTotals(input: TotalsInput): Totals | TotalsProblem {
  const { lines, settings } = input
  const problem = (error: string): TotalsProblem => ({ ok: false, error })

  // The customer's own tax when their account has one, otherwise the store's.
  const exempt = input.tax?.exempt === true
  const ownRate = input.tax?.taxRatePercent
  const chargedRateE4 = rateToE4(ownRate != null && ownRate !== '' ? ownRate : settings.taxRatePercent)
  if (chargedRateE4 == null) return problem('The sales tax rate is not set up. Please call us to place this order.')
  const rateE4 = exempt ? 0 : chargedRateE4
  if (!isCents(settings.localDeliveryMinimumCents) || !isCents(settings.localDeliveryFeeCents)) {
    return problem('Delivery is not set up correctly. Please call us to place this order.')
  }
  if (lines.length === 0) return problem('Your cart is empty.')

  // Line totals (rule 2).
  const lineTotals: number[] = []
  let subtotalCents = 0
  let weight: number | null = 0
  for (const [index, line] of lines.entries()) {
    const position = `Item ${index + 1}`
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return problem(`${position} has no quantity. Remove it or choose how many you need.`)
    if (line.quantity > MAX_QUANTITY) return problem(`${position}: for more than ${MAX_QUANTITY.toLocaleString('en-US')} of one item, please call us.`)
    const priceE5 = toE5(line.unitPrice)
    // A product with no price is never sold: it is a missing price, not a free item.
    if (priceE5 == null || priceE5 <= 0) return problem(`${position} has no price at the moment and can't be ordered online. Please call us.`)
    if (priceE5 > MAX_UNIT_PRICE_E5) return problem(`${position} can't be ordered online. Please call us.`)
    const lineTotal = divideRoundHalfUp(priceE5 * line.quantity, 1000)
    lineTotals.push(lineTotal)
    subtotalCents += lineTotal
    if (weight != null) {
      const each = line.weightLb
      weight = typeof each === 'number' && Number.isFinite(each) && each > 0 ? weight + each * line.quantity : null
    }
  }
  if (subtotalCents > MAX_ORDER_CENTS) return problem('This order is too large to place online. Please call us.')
  const totalWeightLb = weight == null ? null : Math.round(weight * 1000) / 1000

  // Delivery.
  if (input.ups && 'rateCents' in input.ups && !isCents(input.ups.rateCents)) return problem('The UPS rate could not be read. Please try again.')
  const options = deliveryOptions({
    subtotalCents,
    destinationZip: input.destinationZip,
    ups: input.ups,
    allLinesHaveWeight: totalWeightLb != null,
    settings,
  })
  let deliveryCents = 0
  if (input.delivery != null) {
    const chosen = options.find((o) => o.method === input.delivery)
    if (!chosen) return problem('Choose pickup, local delivery or UPS shipping.')
    if (!chosen.available) return problem(chosen.reason ?? 'That delivery choice is not available for this order.')
    if (chosen.chargeCents == null) return problem('We are still getting the UPS rate for this order. Please try again in a moment.')
    deliveryCents = chosen.chargeCents
  }

  // Tax (rules 4 and 5). Each taxable part: the taxable lines, then delivery.
  const parts: { cents: number; line: number | null }[] = []
  if (rateE4 > 0) {
    lineTotals.forEach((cents, line) => {
      if (lines[line].taxable) parts.push({ cents, line })
    })
    if (settings.deliveryTaxable && deliveryCents > 0) parts.push({ cents: deliveryCents, line: null })
  }
  const taxableCents = parts.reduce((sum, part) => sum + part.cents, 0)
  const taxCents = divideRoundHalfUp(taxableCents * rateE4, 1000000)

  const shares = parts.map((part) => {
    const exact = part.cents * rateE4
    const cents = Math.floor(exact / 1000000)
    return { cents, lost: exact - cents * 1000000 }
  })
  let leftover = taxCents - shares.reduce((sum, share) => sum + share.cents, 0)
  const byLoss = shares.map((share, index) => ({ index, lost: share.lost })).sort((a, b) => b.lost - a.lost || a.index - b.index)
  for (const { index } of byLoss) {
    if (leftover <= 0) break
    shares[index].cents += 1
    leftover -= 1
  }

  const lineTax = lineTotals.map(() => 0)
  let deliveryTaxCents = 0
  parts.forEach((part, index) => {
    if (part.line == null) deliveryTaxCents = shares[index].cents
    else lineTax[part.line] = shares[index].cents
  })

  return {
    ok: true,
    lines: lineTotals.map((lineTotalCents, index) => ({ lineTotalCents, taxCents: lineTax[index] })),
    options,
    delivery: input.delivery,
    subtotalCents,
    deliveryCents,
    deliveryTaxCents,
    tax: { taxRatePercent: rateText(rateE4), retailTaxId: input.tax?.retailTaxId?.trim() || null, exempt },
    taxableCents,
    taxCents,
    totalCents: subtotalCents + deliveryCents + taxCents,
    totalWeightLb,
  }
}
