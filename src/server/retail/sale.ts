/*
 * Writing a paid website order into Lightspeed Retail (X-Series) as a sale,
 * so it shows on the register like any other order waiting to be picked up
 * or sent out.
 *
 *   buildSalePayload  turns one of our orders into the sale Lightspeed expects
 *                     (no network; this is the part the tests pin down)
 *   pushSale          sends it, then checks Lightspeed really recorded every
 *                     line and the payment
 *   findSaleForOrder  looks for a sale already made for an order number
 *
 * The sale is sent to POST /api/register_sales, documented at
 * https://x-series-api.lightspeedhq.com/docs/sync_sale_into_vend
 *
 * THINGS THAT CAN GO WRONG, AND WHAT THIS FILE DOES ABOUT THEM
 *   - Lightspeed can answer "OK" to a sale it did not understand and record
 *     an empty one. So the answer is never trusted: pushSale compares the
 *     lines, the payment and the totals with what was sent.
 *   - An answer can be lost on the way back. Sending again would then put
 *     the same order on the register twice. So on any attempt after the
 *     first, pushSale looks for a sale carrying our order number before it
 *     sends anything.
 *   - Prices. Each line is sent with our price, our tax and `price_set: 1`,
 *     which tells the register not to work the price out again.
 *
 * Lightspeed takes a price and a tax "per unit". We send the line's total
 * divided by its quantity (to 5 decimals), so that the register's line
 * total comes back to exactly what the customer paid.
 *
 * Kept free of imports so the tests can run it with a stand-in for `fetch`.
 */

export interface RetailSaleSettings {
  /** Which register website orders appear on. */
  registerId: string
  /** The staff user the sale is recorded under. */
  userId: string
  /** The payment type the card payment is recorded as. */
  paymentTypeId: string
  /** The store's own sales tax, for guests and customers with no tax on their account (same rate as SALES_TAX_RATE_PERCENT). */
  taxId: string
  /** Lightspeed's "No Tax", for goods that are not taxed. */
  noTaxId: string
  /** The 0% tax tax-exempt customers are recorded under, used when the order doesn't name the customer's own. */
  exemptTaxId?: string | null
  /** A product in Lightspeed that stands for the delivery charge. Needed only when delivery is charged for. */
  deliveryProductId?: string | null
  /** A customer in Lightspeed to put guest orders under; a walk-in sale when not set. */
  guestCustomerId?: string | null
}

export interface RetailOrderLine {
  /** The variant's id in Lightspeed Retail (ProductVariants.RetailId). */
  variantRetailId: string
  quantity: number
  /** Unit price x quantity, in cents, as charged. */
  lineTotalCents: number
  /** This line's share of the order's tax, in cents. */
  taxCents: number
  taxable: boolean
}

export interface RetailOrder {
  /** Our order number, e.g. W100001. Sent as the sale's `source_id`. */
  orderNumber: string
  /** The customer's id in Lightspeed Retail; null for a guest. */
  customerRetailId: string | null
  deliveryMethod: 'pickup' | 'local' | 'ups'
  /** Shown to staff on the sale, e.g. "UPS Ground". */
  deliveryService?: string | null
  /**
   * The tax the order was charged under (the `tax` the totals rules return):
   * the customer's own tax id in Lightspeed Retail, or null for the store's
   * default; and whether the customer is tax-exempt.
   */
  tax: { retailTaxId: string | null; exempt: boolean }
  /** A tax-exempt customer's certificate number, shown to staff on the sale. */
  taxExemptCertificate?: string | null
  lines: readonly RetailOrderLine[]
  deliveryCents: number
  deliveryTaxCents: number
  /** What the card was charged, in cents. */
  totalCents: number
  /** When it was paid. */
  paidAt: Date
  /** The customer's note, shown to staff on the sale. */
  customerNote?: string | null
}

export interface SalePayload {
  source_id: string
  register_id: string
  user_id: string
  customer_id?: string
  sale_date: string
  note: string
  state: 'pending'
  register_sale_attributes: ['pickup'] | ['delivery']
  register_sale_products: {
    product_id: string
    quantity: number
    price: number
    tax: number
    tax_id: string
    price_set: 1
    sequence: number
  }[]
  register_sale_payments: {
    retailer_payment_type_id: string
    payment_date: string
    amount: number
  }[]
}

export type BuildResult = { ok: true; payload: SalePayload } | { ok: false; error: string }

const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{8,40}$/i.test(value)
const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isRecordOfTax = (value: unknown): value is RetailOrder['tax'] =>
  typeof value === 'object' && value !== null && typeof (value as { exempt?: unknown }).exempt === 'boolean' && 'retailTaxId' in value

/** 12345 -> 123.45 */
const dollars = (cents: number) => Number((cents / 100).toFixed(2))

/** A line's amount in cents, shared over its quantity, as dollars to 5 decimals. */
function perUnit(cents: number, quantity: number): number {
  const hundredThousandths = Math.round((cents * 1000) / quantity)
  return Number((hundredThousandths / 100000).toFixed(5))
}

/** Lightspeed's date form, in UTC: 2026-11-13 14:05:09 */
function retailDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

const DELIVERY_WORDS = { pickup: 'Warehouse pickup', local: 'Local delivery', ups: 'UPS shipping' } as const

/**
 * Our order as a Lightspeed sale: on the chosen register, under the chosen
 * staff user, on the customer's record, each line at our price with its tax,
 * the card payment in full, marked for pickup or delivery, and carrying our
 * order number. Refuses an order whose figures don't add up, so a wrong
 * sale is never sent.
 */
export function buildSalePayload(order: RetailOrder, settings: RetailSaleSettings): BuildResult {
  const fail = (error: string): BuildResult => ({ ok: false, error })

  for (const [name, value] of Object.entries({ RETAIL_REGISTER_ID: settings.registerId, RETAIL_USER_ID: settings.userId, RETAIL_PAYMENT_TYPE_ID: settings.paymentTypeId, RETAIL_TAX_ID: settings.taxId, RETAIL_NO_TAX_ID: settings.noTaxId })) {
    if (!isId(value)) return fail(`${name} is not set (see scripts/retail-settings.mjs).`)
  }
  if (!/^[\w-]{1,40}$/.test(order.orderNumber)) return fail('The order has no order number.')
  if (order.customerRetailId != null && !isId(order.customerRetailId)) return fail('The customer’s Lightspeed id is not valid.')
  if (!(order.paidAt instanceof Date) || Number.isNaN(order.paidAt.getTime())) return fail('The order has no payment date.')
  if (!(order.deliveryMethod in DELIVERY_WORDS)) return fail('The order has no delivery method.')
  if (order.lines.length === 0) return fail('The order has no lines.')
  if (!isCents(order.deliveryCents) || !isCents(order.deliveryTaxCents) || !isCents(order.totalCents)) return fail('The order’s amounts are not whole cents.')
  if (order.deliveryTaxCents > 0 && order.deliveryCents === 0) return fail('The order has tax on a delivery charge of zero.')

  if (!isRecordOfTax(order.tax)) return fail('The order does not say which tax it was charged under.')
  if (order.tax.retailTaxId != null && !isId(order.tax.retailTaxId)) return fail('The customer’s tax id is not valid.')
  const exempt = order.tax.exempt
  // Taxed goods go under the customer's own tax, or the store's when they have none.
  // An exempt customer's whole sale goes under their 0% exemption tax.
  const chargedTaxId = order.tax.retailTaxId ?? settings.taxId
  const exemptTaxId = order.tax.retailTaxId ?? (isId(settings.exemptTaxId) ? settings.exemptTaxId : settings.noTaxId)
  const products: SalePayload['register_sale_products'] = []
  let sumCents = 0
  for (const [index, line] of order.lines.entries()) {
    const position = `Line ${index + 1}`
    if (!isId(line.variantRetailId)) return fail(`${position} has no Lightspeed product id.`)
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return fail(`${position} has no quantity.`)
    if (!isCents(line.lineTotalCents) || line.lineTotalCents === 0) return fail(`${position} has no price.`)
    if (!isCents(line.taxCents)) return fail(`${position} has a tax amount that is not whole cents.`)
    if (line.taxCents > 0 && (exempt || !line.taxable)) return fail(`${position} carries tax, but it or the customer is not taxed.`)
    products.push({
      product_id: line.variantRetailId,
      quantity: line.quantity,
      price: perUnit(line.lineTotalCents, line.quantity),
      tax: perUnit(line.taxCents, line.quantity),
      tax_id: exempt ? exemptTaxId : line.taxable ? chargedTaxId : settings.noTaxId,
      price_set: 1,
      sequence: index,
    })
    sumCents += line.lineTotalCents + line.taxCents
  }

  if (order.deliveryCents > 0) {
    if (order.deliveryTaxCents > 0 && exempt) return fail('The delivery charge carries tax, but the customer is not taxed.')
    if (!isId(settings.deliveryProductId)) return fail('This order has a delivery charge, but RETAIL_DELIVERY_PRODUCT_ID is not set.')
    products.push({
      product_id: settings.deliveryProductId,
      quantity: 1,
      price: dollars(order.deliveryCents),
      tax: dollars(order.deliveryTaxCents),
      tax_id: exempt ? exemptTaxId : order.deliveryTaxCents > 0 ? chargedTaxId : settings.noTaxId,
      price_set: 1,
      sequence: products.length,
    })
    sumCents += order.deliveryCents + order.deliveryTaxCents
  }

  // The payment must cover the sale exactly; a sale that is a cent out would sit unpaid on the register.
  if (sumCents !== order.totalCents) return fail('The order’s lines, delivery and tax do not add up to its total.')

  const noteParts = [`Website order ${order.orderNumber}`, [DELIVERY_WORDS[order.deliveryMethod], order.deliveryService?.trim()].filter(Boolean).join(': ')]
  const customerNote = order.customerNote?.replace(/\s+/g, ' ').trim()
  const certificate = order.taxExemptCertificate?.replace(/\s+/g, ' ').trim()
  if (exempt) noteParts.push(certificate ? `Tax-exempt, certificate ${certificate}` : 'Tax-exempt')
  if (customerNote) noteParts.push(`Customer note: ${customerNote}`)

  const customerId = order.customerRetailId ?? (isId(settings.guestCustomerId) ? settings.guestCustomerId : null)
  const when = retailDate(order.paidAt)
  const payload: SalePayload = {
    source_id: order.orderNumber,
    register_id: settings.registerId,
    user_id: settings.userId,
    ...(customerId ? { customer_id: customerId } : {}),
    sale_date: when,
    note: noteParts.join('. ').slice(0, 500),
    // "pending" with an attribute means paid and waiting to be picked up or sent out.
    // ("pending" with no attribute is reserved by Lightspeed and must never be sent.)
    state: 'pending',
    register_sale_attributes: order.deliveryMethod === 'pickup' ? ['pickup'] : ['delivery'],
    register_sale_products: products,
    register_sale_payments: [{ retailer_payment_type_id: settings.paymentTypeId, payment_date: when, amount: dollars(order.totalCents) }],
  }
  return { ok: true, payload }
}

/**
 * The store's own choices in Lightspeed Retail, as the owner decided them
 * (ids from scripts/retail-settings.mjs). Each can be changed in .env.local.
 */
export const RETAIL_DEFAULTS = {
  /** "Online register" */
  registerId: '02a1177e-23fb-11f1-ecbf-b5edde93ce21',
  /** "Online payments" */
  paymentTypeId: 'e8198a80-2681-42b0-92c1-0631c3d2eaa0',
  /** "FL - Broward County", 7%: the outlet's default tax */
  taxId: 'bd67debe-d9e0-44d8-a16e-3f47569ba733',
  /** "No Tax" */
  noTaxId: '020b2c2a-46fb-11f1-e200-27c80837d369',
  /** "Florida Resellers Tax Exempt Certificate Holder", 0% */
  exemptTaxId: '02a1177e-23fb-11f1-ecbf-be979573bc14',
} as const

/**
 * Reads the RETAIL_… settings from .env.local (see README), falling back to
 * the store's choices above. The staff user has no default: until
 * RETAIL_USER_ID is set, buildSalePayload refuses every order.
 */
export function retailSaleSettingsFromEnv(env: Record<string, string | undefined> = process.env): RetailSaleSettings {
  const value = (name: string) => env[name]?.trim() || null
  return {
    registerId: value('RETAIL_REGISTER_ID') ?? RETAIL_DEFAULTS.registerId,
    userId: value('RETAIL_USER_ID') ?? '',
    paymentTypeId: value('RETAIL_PAYMENT_TYPE_ID') ?? RETAIL_DEFAULTS.paymentTypeId,
    taxId: value('RETAIL_TAX_ID') ?? RETAIL_DEFAULTS.taxId,
    noTaxId: value('RETAIL_NO_TAX_ID') ?? RETAIL_DEFAULTS.noTaxId,
    exemptTaxId: value('RETAIL_EXEMPT_TAX_ID') ?? RETAIL_DEFAULTS.exemptTaxId,
    deliveryProductId: value('RETAIL_DELIVERY_PRODUCT_ID'),
    guestCustomerId: value('RETAIL_GUEST_CUSTOMER_ID'),
  }
}

export interface RetailConnection {
  /** The store's Lightspeed subdomain: the part before .retail.lightspeed.app */
  domainPrefix: string
  /** A Lightspeed Retail token that is allowed to create sales. */
  accessToken: string
  timeoutMs?: number
  /** Stand-in for fetch, for tests. */
  fetch?: typeof fetch
}

/** Sending sales is switched off, or the Lightspeed settings are missing. */
export class RetailSalesNotEnabled extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RetailSalesNotEnabled'
  }
}

/**
 * The connection for writing sales. Refuses unless RETAIL_SALES_ENABLED=true:
 * the register is live, so writing to it is a switch the owner turns on.
 */
export function retailConnectionFromEnv(env: Record<string, string | undefined> = process.env): RetailConnection {
  if (env.RETAIL_SALES_ENABLED?.trim().toLowerCase() !== 'true') throw new RetailSalesNotEnabled('Sending orders to Lightspeed Retail is switched off (RETAIL_SALES_ENABLED is not "true").')
  const domainPrefix = env.LIGHTSPEED_DOMAIN_PREFIX?.trim()
  const accessToken = env.LIGHTSPEED_ACCESS_TOKEN?.trim()
  if (!domainPrefix || !accessToken) throw new RetailSalesNotEnabled('Set LIGHTSPEED_DOMAIN_PREFIX and LIGHTSPEED_ACCESS_TOKEN in .env.local.')
  if (!/^[a-z0-9-]+$/i.test(domainPrefix)) throw new RetailSalesNotEnabled('LIGHTSPEED_DOMAIN_PREFIX must be just the store subdomain.')
  return { domainPrefix, accessToken }
}

export type PushResult =
  | {
      ok: true
      saleId: string
      invoiceNumber: string | null
      /** True when the sale was already there from an earlier attempt and nothing was sent this time. */
      alreadyExisted: boolean
    }
  | {
      ok: false
      /** Why, for staff and the order history. Never contains the access token. */
      error: string
      /**
       * True: safe to try again later by itself (a passing fault; the next
       * attempt first checks whether the sale was created after all).
       * False: a person has to look, either at the settings or at the sale
       * named in saleId.
       */
      retryable: boolean
      /** Set when Lightspeed did create a sale, but not the one we sent. */
      saleId: string | null
    }

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : [])
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
const amountCents = (value: unknown): number | null => {
  const amount = typeof value === 'string' ? Number(value) : value
  return typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : null
}

/** The lines of a sale Lightspeed returned, whichever of its two layouts it used. */
const saleLines = (sale: Json) => (Array.isArray(sale.register_sale_products) ? list(sale.register_sale_products) : list(sale.line_items))
const salePayments = (sale: Json) => (Array.isArray(sale.register_sale_payments) ? list(sale.register_sale_payments) : list(sale.payments))

/**
 * Does the sale Lightspeed says it recorded match the one we sent? Returns
 * the first difference found, in words, or null when it matches.
 */
export function saleMismatch(sale: Json, sent: SalePayload): string | null {
  if (!text(sale.id)) return 'the answer had no sale id'
  const sourceId = text(sale.source_id)
  if (sourceId != null && sourceId !== sent.source_id) return `the sale carries order number ${sourceId}, not ${sent.source_id}`

  const state = text(sale.state)
  if (state != null && state !== 'pending') return `the sale is "${state}", not waiting for pickup or delivery`

  const wanted = new Map<string, number>()
  for (const line of sent.register_sale_products) wanted.set(line.product_id, (wanted.get(line.product_id) ?? 0) + line.quantity)
  const got = new Map<string, number>()
  for (const line of saleLines(sale)) {
    const productId = text(line.product_id)
    if (productId) got.set(productId, (got.get(productId) ?? 0) + Number(line.quantity ?? 0))
  }
  if (got.size === 0) return 'the sale was recorded with no lines'
  for (const [productId, quantity] of wanted) {
    if (got.get(productId) !== quantity) return `product ${productId} was recorded with quantity ${got.get(productId) ?? 0}, not ${quantity}`
  }
  if (got.size !== wanted.size) return 'the sale has lines we did not send'

  const paidCents = salePayments(sale).reduce((sum, payment) => sum + (amountCents(payment.amount) ?? 0), 0)
  const wantedCents = sent.register_sale_payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
  if (salePayments(sale).length === 0) return 'the sale was recorded with no payment'
  if (paidCents !== wantedCents) return `the payment was recorded as ${(paidCents / 100).toFixed(2)}, not ${(wantedCents / 100).toFixed(2)}`

  // The register's own total for the sale must equal what was paid, or it will show money owing or over.
  const totals = isRecord(sale.totals) ? sale.totals : null
  const priceCents = amountCents(totals?.total_price ?? sale.total_price)
  const taxCents = amountCents(totals?.total_tax ?? sale.total_tax)
  if (priceCents != null && taxCents != null && priceCents + taxCents !== wantedCents) {
    return `the register totals the sale at ${((priceCents + taxCents) / 100).toFixed(2)}, but ${(wantedCents / 100).toFixed(2)} was paid`
  }
  return null
}

interface Reply {
  status: number | null
  body: unknown
  failure: string | null
}

async function call(connection: RetailConnection, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
  const doFetch = connection.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`https://${connection.domainPrefix}.retail.lightspeed.app${path}`, {
      method,
      headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(connection.timeoutMs ?? 30_000),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { status: null, body: null, failure: name === 'TimeoutError' || name === 'AbortError' ? 'Lightspeed did not answer in time' : 'Lightspeed could not be reached' }
  }
  let parsed: unknown = null
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    parsed = null
  }
  if (!response.ok) return { status: response.status, body: parsed, failure: `Lightspeed answered HTTP ${response.status}` }
  return { status: response.status, body: parsed, failure: parsed == null ? 'Lightspeed’s answer could not be read' : null }
}

export type FindResult = { found: true; sale: Json } | { found: false } | { found: 'unknown'; error: string }

/**
 * Looks for a sale already recorded for an order number: sales on our
 * register from the day before the order was paid onwards, newest first,
 * matched on `source_id`. Reads only.
 */
export async function findSaleForOrder(connection: RetailConnection, orderNumber: string, registerId: string, paidAt: Date): Promise<FindResult> {
  const from = new Date(paidAt.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const pageSize = 200
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const query = new URLSearchParams({ type: 'sales', register_id: registerId, date_from: from, order_by: 'date', order_direction: 'desc', page_size: String(pageSize), offset: String(offset) })
    const reply = await call(connection, 'GET', `/api/2.0/search?${query}`)
    if (reply.failure != null || !isRecord(reply.body) || !Array.isArray(reply.body.data)) return { found: 'unknown', error: reply.failure ?? 'the search answer was not in the expected form' }
    const sales = list(reply.body.data)
    const match = sales.find((sale) => text(sale.source_id) === orderNumber && text(sale.state) !== 'voided' && text(sale.status) !== 'VOIDED')
    if (match) return { found: true, sale: match }
    if (sales.length < pageSize) return { found: false }
  }
  return { found: 'unknown', error: 'too many sales to search through' }
}

/**
 * Sends an order to Lightspeed Retail and makes sure it arrived whole.
 * `earlierAttempts` is how many times this order has been tried before;
 * from the second try on, an existing sale is looked for first.
 */
export async function pushSale(order: RetailOrder, settings: RetailSaleSettings, connection: RetailConnection, earlierAttempts = 0): Promise<PushResult> {
  const built = buildSalePayload(order, settings)
  if (!built.ok) return { ok: false, error: built.error, retryable: false, saleId: null }
  const { payload } = built

  if (earlierAttempts > 0) {
    const existing = await findSaleForOrder(connection, order.orderNumber, settings.registerId, order.paidAt)
    if (existing.found === 'unknown') return { ok: false, error: `Could not check for an earlier sale (${existing.error}); nothing was sent.`, retryable: true, saleId: null }
    if (existing.found) {
      const saleId = text(existing.sale.id)
      const difference = saleMismatch(existing.sale, payload)
      if (difference != null || saleId == null) return { ok: false, error: `A sale for this order already exists in Lightspeed but does not match: ${difference ?? 'no id'}.`, retryable: false, saleId }
      return { ok: true, saleId, invoiceNumber: text(existing.sale.invoice_number), alreadyExisted: true }
    }
  }

  const reply = await call(connection, 'POST', '/api/register_sales', payload)
  if (reply.failure != null) {
    // No answer, "too many requests" or a fault on Lightspeed's side may pass. Anything else (401, 403, 400, 404, 422…) needs a person.
    const passing = reply.status == null || reply.status === 408 || reply.status === 429 || reply.status >= 500 || (reply.status >= 200 && reply.status < 300)
    const why = isRecord(reply.body) ? text(reply.body.error) ?? text(reply.body.message) ?? text(reply.body.details) : null
    return { ok: false, error: `${reply.failure}${why ? `: ${why.slice(0, 200)}` : ''}.`, retryable: passing, saleId: null }
  }

  const sale = isRecord(reply.body) && isRecord(reply.body.register_sale) ? reply.body.register_sale : isRecord(reply.body) ? reply.body : null
  if (sale == null) return { ok: false, error: 'Lightspeed’s answer did not contain a sale.', retryable: true, saleId: null }
  const saleId = text(sale.id)
  const difference = saleMismatch(sale, payload)
  if (difference != null) {
    // With no id there is nothing on the register to look at, and the next attempt checks before sending again.
    return { ok: false, error: `Lightspeed answered OK, but ${difference}.`, retryable: saleId == null, saleId }
  }
  return { ok: true, saleId: saleId as string, invoiceNumber: text(sale.invoice_number), alreadyExisted: false }
}
