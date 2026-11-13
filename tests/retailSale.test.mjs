import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeTotals } from '../src/server/checkout/totals.ts'
import {
  RETAIL_DEFAULTS,
  RetailSalesNotEnabled,
  buildSalePayload,
  findSaleForOrder,
  pushSale,
  retailConnectionFromEnv,
  retailSaleSettingsFromEnv,
  saleMismatch,
} from '../src/server/retail/sale.ts'

// Made-up ids. Nothing here talks to Lightspeed: `fetch` is replaced by a stand-in.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SETTINGS = {
  registerId: id(1),
  userId: id(2),
  paymentTypeId: id(3),
  taxId: id(4),
  noTaxId: id(5),
  exemptTaxId: id(6),
  deliveryProductId: id(7),
  guestCustomerId: null,
}
const PRODUCT_A = id(101)
const PRODUCT_B = id(102)
const CUSTOMER = id(201)

/** A pickup order of 3 x $240.28037 and 2 x $4.25 (untaxed), at 7%. */
const ORDER = {
  orderNumber: 'W100001',
  customerRetailId: CUSTOMER,
  deliveryMethod: 'pickup',
  tax: { retailTaxId: null, exempt: false },
  lines: [
    { variantRetailId: PRODUCT_A, quantity: 3, lineTotalCents: 72084, taxCents: 5046, taxable: true },
    { variantRetailId: PRODUCT_B, quantity: 2, lineTotalCents: 850, taxCents: 0, taxable: false },
  ],
  deliveryCents: 0,
  deliveryTaxCents: 0,
  totalCents: 72084 + 5046 + 850,
  paidAt: new Date('2026-11-13T14:05:09.123Z'),
  customerNote: null,
}

const build = (order = {}, settings = {}) => buildSalePayload({ ...ORDER, ...order }, { ...SETTINGS, ...settings })

test('the sale Lightspeed is sent for a pickup order', () => {
  const result = build()
  assert.equal(result.ok, true)
  assert.deepEqual(result.payload, {
    source_id: 'W100001',
    register_id: SETTINGS.registerId,
    user_id: SETTINGS.userId,
    customer_id: CUSTOMER,
    sale_date: '2026-11-13 14:05:09',
    note: 'Website order W100001. Warehouse pickup',
    state: 'pending',
    register_sale_attributes: ['pickup'],
    register_sale_products: [
      { product_id: PRODUCT_A, quantity: 3, price: 240.28, tax: 16.82, tax_id: SETTINGS.taxId, price_set: 1, sequence: 0 },
      { product_id: PRODUCT_B, quantity: 2, price: 4.25, tax: 0, tax_id: SETTINGS.noTaxId, price_set: 1, sequence: 1 },
    ],
    register_sale_payments: [{ retailer_payment_type_id: SETTINGS.paymentTypeId, payment_date: '2026-11-13 14:05:09', amount: 779.8 }],
  })
})

test('every line is price-locked, tax-exclusive, with a tax id', () => {
  const { payload } = build()
  for (const line of payload.register_sale_products) {
    assert.equal(line.price_set, 1)
    assert.match(line.tax_id, /^[0-9a-f-]{36}$/)
    assert.equal(typeof line.price, 'number')
    assert.equal(typeof line.tax, 'number')
  }
})

test('unit price and unit tax times the quantity come back to the cents charged', () => {
  // Awkward splits: 3 units sharing 100 cents, 7 units sharing 5 cents of tax.
  const lines = [
    { variantRetailId: PRODUCT_A, quantity: 3, lineTotalCents: 100, taxCents: 7, taxable: true },
    { variantRetailId: PRODUCT_B, quantity: 7, lineTotalCents: 6999, taxCents: 5, taxable: true },
  ]
  const { payload } = build({ lines, totalCents: 100 + 7 + 6999 + 5 })
  payload.register_sale_products.forEach((sent, index) => {
    assert.equal(Math.round(sent.price * sent.quantity * 100), lines[index].lineTotalCents)
    assert.equal(Math.round(sent.tax * sent.quantity * 100), lines[index].taxCents)
    // Never more than Lightspeed's 5 decimals.
    assert.equal(Number(sent.price.toFixed(5)), sent.price)
    assert.equal(Number(sent.tax.toFixed(5)), sent.tax)
  })
  assert.equal(payload.register_sale_products[0].price, 0.33333)
})

test('delivery orders are marked for delivery; the charge goes on as its own line', () => {
  const local = build({ deliveryMethod: 'local' })
  assert.deepEqual(local.payload.register_sale_attributes, ['delivery'])
  assert.equal(local.payload.register_sale_products.length, 2) // free delivery adds no line
  assert.match(local.payload.note, /Local delivery/)

  const ups = build({ deliveryMethod: 'ups', deliveryService: 'UPS Ground', deliveryCents: 1850, deliveryTaxCents: 130, totalCents: ORDER.totalCents + 1980, customerNote: '  Leave at\n the loading dock ' })
  assert.deepEqual(ups.payload.register_sale_attributes, ['delivery'])
  assert.deepEqual(ups.payload.register_sale_products[2], { product_id: SETTINGS.deliveryProductId, quantity: 1, price: 18.5, tax: 1.3, tax_id: SETTINGS.taxId, price_set: 1, sequence: 2 })
  assert.equal(ups.payload.register_sale_payments[0].amount, 799.6)
  assert.equal(ups.payload.note, 'Website order W100001. UPS shipping: UPS Ground. Customer note: Leave at the loading dock')

  const untaxed = build({ deliveryMethod: 'ups', deliveryCents: 1850, totalCents: ORDER.totalCents + 1850 })
  assert.equal(untaxed.payload.register_sale_products[2].tax_id, SETTINGS.noTaxId)

  const noProduct = build({ deliveryMethod: 'ups', deliveryCents: 1850, totalCents: ORDER.totalCents + 1850 }, { deliveryProductId: null })
  assert.equal(noProduct.ok, false)
  assert.match(noProduct.error, /RETAIL_DELIVERY_PRODUCT_ID/)
})

test('"pending" is never sent without pickup or delivery', () => {
  for (const deliveryMethod of ['pickup', 'local', 'ups']) {
    const { payload } = build({ deliveryMethod })
    assert.equal(payload.state, 'pending')
    assert.equal(payload.register_sale_attributes.length, 1)
  }
  assert.equal(build({ deliveryMethod: 'drone' }).ok, false)
})

const CUSTOMER_TAX = id(301) // the tax on a customer's own account, e.g. another county's
const RESELLER_TAX = id(302) // the customer's 0% exemption tax

test('a customer’s taxed lines go under the tax on their own account', () => {
  const { payload } = build({ tax: { retailTaxId: CUSTOMER_TAX, exempt: false } })
  // The taxed line carries the customer's tax; the untaxed line stays "No Tax".
  assert.deepEqual(payload.register_sale_products.map((l) => l.tax_id), [CUSTOMER_TAX, SETTINGS.noTaxId])
  // And so does a taxed delivery charge.
  const ups = build({ tax: { retailTaxId: CUSTOMER_TAX, exempt: false }, deliveryMethod: 'ups', deliveryCents: 1000, deliveryTaxCents: 65, totalCents: ORDER.totalCents + 1065 })
  assert.equal(ups.payload.register_sale_products[2].tax_id, CUSTOMER_TAX)
  // A guest, or a customer with no tax on their account, gets the store's tax.
  assert.equal(build().payload.register_sale_products[0].tax_id, SETTINGS.taxId)
})

test('a tax-exempt customer’s sale goes under their exemption tax, with no tax amount', () => {
  const lines = ORDER.lines.map((line) => ({ ...line, taxCents: 0 }))
  const exempt = build({ tax: { retailTaxId: RESELLER_TAX, exempt: true }, taxExemptCertificate: ' 85-0000000000C-0 ', lines, totalCents: 72084 + 850 })
  assert.deepEqual(exempt.payload.register_sale_products.map((l) => [l.tax, l.tax_id]), [[0, RESELLER_TAX], [0, RESELLER_TAX]])
  assert.equal(exempt.payload.note, 'Website order W100001. Warehouse pickup. Tax-exempt, certificate 85-0000000000C-0')
  // Delivery on an exempt order is under the same tax, untaxed.
  const shipped = build({ tax: { retailTaxId: RESELLER_TAX, exempt: true }, lines, deliveryMethod: 'ups', deliveryCents: 1850, totalCents: 72084 + 850 + 1850 })
  assert.deepEqual([shipped.payload.register_sale_products[2].tax, shipped.payload.register_sale_products[2].tax_id], [0, RESELLER_TAX])
  // If the order doesn't name the customer's tax, the store's exemption tax is used; failing that, "No Tax".
  const fallback = build({ tax: { retailTaxId: null, exempt: true }, lines, totalCents: 72084 + 850 })
  assert.deepEqual(fallback.payload.register_sale_products.map((l) => l.tax_id), [SETTINGS.exemptTaxId, SETTINGS.exemptTaxId])
  assert.match(fallback.payload.note, /Tax-exempt$/)
  const plain = build({ tax: { retailTaxId: null, exempt: true }, lines, totalCents: 72084 + 850 }, { exemptTaxId: null })
  assert.deepEqual(plain.payload.register_sale_products.map((l) => l.tax_id), [SETTINGS.noTaxId, SETTINGS.noTaxId])
  // Tax on an exempt customer's order is a mistake upstream, and is refused.
  assert.equal(build({ tax: { retailTaxId: RESELLER_TAX, exempt: true } }).ok, false)
  assert.equal(build({ tax: { retailTaxId: RESELLER_TAX, exempt: true }, lines, deliveryMethod: 'ups', deliveryCents: 1850, deliveryTaxCents: 130, totalCents: 72084 + 850 + 1980 }).ok, false)
})

test('an order that does not say which tax it was charged under is refused', () => {
  assert.match(build({ tax: undefined }).error, /which tax/)
  assert.match(build({ tax: { exempt: false } }).error, /which tax/)
  assert.match(build({ tax: { retailTaxId: 'not-an-id', exempt: false } }).error, /tax id/)
})

const GUEST = id(999) // the "Website guest" customer

test('a guest order goes under the "Website guest" customer, with who ordered on the note', () => {
  const guest = build(
    {
      customerRetailId: null,
      deliveryMethod: 'local',
      contact: { name: ' Test  Buyer ', company: 'Test Co', email: 'buyer@example.com', phone: '555-0100' },
      deliveryAddress: '1 Test St,\n Testville, FL 33312',
      customerNote: 'Ring the bell',
    },
    { guestCustomerId: GUEST },
  )
  assert.equal(guest.payload.customer_id, GUEST)
  assert.equal(guest.payload.note, 'Website order W100001. Local delivery. Guest: Test Buyer, Test Co, buyer@example.com, 555-0100. Deliver to: 1 Test St, Testville, FL 33312. Customer note: Ring the bell')
  // With no contact details handed in, the note still says it is a guest.
  assert.match(build({ customerRetailId: null }, { guestCustomerId: GUEST }).payload.note, /Guest order$/)
  // An account customer keeps their own record, and their contact details stay off the note.
  const account = build({ contact: { name: 'Test Buyer' }, deliveryAddress: '1 Test St' }, { guestCustomerId: GUEST })
  assert.equal(account.payload.customer_id, CUSTOMER)
  assert.equal(account.payload.note, 'Website order W100001. Warehouse pickup') // pickup: no address either
  assert.match(build({ deliveryMethod: 'ups', deliveryAddress: '1 Test St' }).payload.note, /Deliver to: 1 Test St$/)
})

test('a guest order is never a walk-in sale: without the guest customer it waits', async () => {
  for (const guestCustomerId of [null, undefined, '', 'guest']) {
    const result = build({ customerRetailId: null }, { guestCustomerId })
    assert.deepEqual([result.ok, result.waitingForSetup], [false, true])
    assert.match(result.error, /"Website guest".*RETAIL_GUEST_CUSTOMER_ID/)
  }
  // Nothing is sent, and it is worth trying again: it goes through once the setting is in.
  const retail = fakeRetail()
  const waiting = await pushSale({ ...ORDER, customerRetailId: null }, SETTINGS, retail.connection)
  assert.deepEqual([waiting.ok, waiting.retryable, waiting.saleId], [false, true, null])
  assert.match(waiting.error, /RETAIL_GUEST_CUSTOMER_ID/)
  assert.equal(retail.calls.length, 0)

  const guestOrder = { ...ORDER, customerRetailId: null }
  const settings = { ...SETTINGS, guestCustomerId: GUEST }
  const later = fakeRetail(recorded(buildSalePayload(guestOrder, settings).payload))
  assert.equal((await pushSale(guestOrder, settings, later.connection, 1 - 1)).ok, true)
  assert.equal(later.calls[0].body.customer_id, GUEST)
  // An order that is wrong in itself is still not retried, guest or not.
  assert.equal(build({ customerRetailId: null, totalCents: 1 }).waitingForSetup, undefined)
})

test('an order whose figures do not add up is refused, not sent', () => {
  assert.match(build({ totalCents: ORDER.totalCents + 1 }).error, /do not add up/)
  assert.equal(build({ lines: [] }).ok, false)
  assert.equal(build({ lines: [{ ...ORDER.lines[0], quantity: 0 }] }).ok, false)
  assert.equal(build({ lines: [{ ...ORDER.lines[0], lineTotalCents: 0 }] }).ok, false)
  assert.equal(build({ lines: [{ ...ORDER.lines[0], variantRetailId: '' }] }).ok, false)
  assert.equal(build({ lines: [{ ...ORDER.lines[1], taxCents: 5 }] }).ok, false) // tax on an untaxed line
  assert.equal(build({ orderNumber: '' }).ok, false)
  assert.equal(build({ paidAt: new Date('nonsense') }).ok, false)
  assert.equal(build({ deliveryTaxCents: 5 }).ok, false)
  assert.match(build({}, { registerId: '' }).error, /RETAIL_REGISTER_ID/)
  assert.match(build({}, { taxId: 'tax' }).error, /RETAIL_TAX_ID/)
})

test('the totals rules and the sale agree: what is charged is what the register is told', () => {
  const cart = [
    { unitPrice: '240.28037', quantity: 3, taxable: true, retailId: PRODUCT_A },
    { unitPrice: '0.64382', quantity: 250, taxable: true, retailId: PRODUCT_B },
  ]
  // A customer whose account carries another county's 6.5% tax.
  const totals = computeTotals({ lines: cart, delivery: 'pickup', tax: { taxRatePercent: 6.5, retailTaxId: CUSTOMER_TAX, exempt: false }, settings: { taxRatePercent: 7, localZips: [], localDeliveryMinimumCents: 20000, localDeliveryFeeCents: 0, deliveryTaxable: true } })
  // The totals' `tax` goes straight onto the order for the sale builder.
  const result = build({
    tax: totals.tax,
    lines: cart.map((line, index) => ({ variantRetailId: line.retailId, quantity: line.quantity, taxable: true, ...totals.lines[index] })),
    totalCents: totals.totalCents,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.payload.register_sale_products.map((l) => l.tax_id), [CUSTOMER_TAX, CUSTOMER_TAX])
  const registerCents = result.payload.register_sale_products.reduce((sum, l) => sum + Math.round((l.price + l.tax) * l.quantity * 100), 0)
  assert.equal(registerCents, totals.totalCents)
  assert.equal(Math.round(result.payload.register_sale_payments[0].amount * 100), totals.totalCents)
})

// ---- sending ---------------------------------------------------------------

const TOKEN = 'test-access-token-0000'

/** Stand-in for Lightspeed: plays back answers in order and keeps what was sent. */
function fakeRetail(...answers) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null })
    const answer = answers.shift()
    if (answer === undefined) throw new Error('unexpected extra request')
    if (answer instanceof Error) throw answer
    const { status = 200, body } = answer
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  return { calls, connection: { domainPrefix: 'teststore', accessToken: TOKEN, fetch, timeoutMs: 1000 } }
}

/** What Lightspeed answers when it recorded the sale as sent. */
const recorded = (payload, changes = {}) => ({
  status: 200,
  body: {
    register_sale: {
      id: id(5000),
      source_id: payload.source_id,
      state: 'pending',
      invoice_number: '1234',
      register_sale_products: payload.register_sale_products.map((l) => ({ product_id: l.product_id, quantity: l.quantity, price: l.price, tax: l.tax })),
      register_sale_payments: payload.register_sale_payments.map((p) => ({ id: id(6000), amount: p.amount })),
      totals: { total_price: '729.34000', total_tax: '50.46000', total_payment: '779.80000', total_to_pay: '0.00000' },
      ...changes,
    },
  },
})
const PAYLOAD = build().payload
const TIMEOUT = Object.assign(new Error('timed out'), { name: 'TimeoutError' })

test('a sale that arrives whole is reported with its id and receipt number', async () => {
  const retail = fakeRetail(recorded(PAYLOAD))
  const result = await pushSale(ORDER, SETTINGS, retail.connection)
  assert.deepEqual(result, { ok: true, saleId: id(5000), invoiceNumber: '1234', alreadyExisted: false })
  assert.equal(retail.calls.length, 1)
  assert.equal(retail.calls[0].url, 'https://teststore.retail.lightspeed.app/api/register_sales')
  assert.equal(retail.calls[0].method, 'POST')
  assert.equal(retail.calls[0].auth, `Bearer ${TOKEN}`)
  assert.deepEqual(retail.calls[0].body, PAYLOAD)
})

test('"OK" with an empty sale is a failure a person must look at, with the sale’s id', async () => {
  const cases = [
    [{ register_sale_products: [] }, /no lines/],
    [{ register_sale_payments: [] }, /no payment/],
    [{ register_sale_products: [{ product_id: PRODUCT_A, quantity: 3 }] }, /quantity 0, not 2/],
    [{ register_sale_products: [{ product_id: PRODUCT_A, quantity: 1 }, { product_id: PRODUCT_B, quantity: 2 }] }, /quantity 1, not 3/],
    [{ register_sale_payments: [{ amount: 700 }] }, /700\.00, not 779\.80/],
    [{ totals: { total_price: '729.34', total_tax: '51.05' } }, /780\.39, but 779\.80 was paid/],
    [{ source_id: 'W999999' }, /W999999/],
    [{ state: 'closed' }, /closed/],
  ]
  for (const [changes, why] of cases) {
    const retail = fakeRetail(recorded(PAYLOAD, changes))
    const result = await pushSale(ORDER, SETTINGS, retail.connection)
    assert.equal(result.ok, false)
    assert.equal(result.retryable, false)
    assert.equal(result.saleId, id(5000))
    assert.match(result.error, why)
  }
})

test('an answer with no sale in it can be tried again (after checking)', async () => {
  for (const body of [{}, { register_sale: { register_sale_products: [] } }, 'not json']) {
    const result = await pushSale(ORDER, SETTINGS, fakeRetail({ status: 200, body }).connection)
    assert.deepEqual([result.ok, result.retryable, result.saleId], [false, true, null])
  }
})

test('passing faults can be retried; faults in the request or the token cannot', async () => {
  for (const answer of [TIMEOUT, new TypeError('fetch failed'), { status: 500, body: {} }, { status: 503, body: 'down' }, { status: 429, body: {} }]) {
    const result = await pushSale(ORDER, SETTINGS, fakeRetail(answer).connection)
    assert.deepEqual([result.ok, result.retryable], [false, true])
  }
  for (const status of [400, 401, 403, 404, 422]) {
    const result = await pushSale(ORDER, SETTINGS, fakeRetail({ status, body: { error: 'nope' } }).connection)
    assert.deepEqual([result.ok, result.retryable], [false, false])
    assert.match(result.error, new RegExp(`HTTP ${status}: nope`))
  }
})

test('the access token never appears in a result', async () => {
  for (const answer of [{ status: 401, body: { error: `bad token ${TOKEN}`.replace(TOKEN, 'x') } }, TIMEOUT, recorded(PAYLOAD, { register_sale_products: [] })]) {
    const result = await pushSale(ORDER, SETTINGS, fakeRetail(answer).connection)
    assert.equal(JSON.stringify(result).includes(TOKEN), false)
  }
})

test('an order that cannot be built is not sent at all', async () => {
  const retail = fakeRetail()
  const result = await pushSale({ ...ORDER, totalCents: 1 }, SETTINGS, retail.connection)
  assert.deepEqual([result.ok, result.retryable], [false, false])
  assert.equal(retail.calls.length, 0)
})

/** A sale as the search returns it (the newer layout: line_items and payments). */
const searchHit = (changes = {}) => ({
  id: id(5000),
  source_id: 'W100001',
  state: 'pending',
  invoice_number: '1234',
  total_price: 729.34,
  total_tax: 50.46,
  line_items: PAYLOAD.register_sale_products.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
  payments: [{ amount: 779.8 }],
  ...changes,
})

test('second try: a sale already there for the order is found and nothing is sent again', async () => {
  const retail = fakeRetail({ status: 200, body: { data: [{ id: id(4000), source_id: 'W100000' }, searchHit()] } })
  const result = await pushSale(ORDER, SETTINGS, retail.connection, 1)
  assert.deepEqual(result, { ok: true, saleId: id(5000), invoiceNumber: '1234', alreadyExisted: true })
  assert.equal(retail.calls.length, 1)
  assert.equal(retail.calls[0].method, 'GET')
  const url = new URL(retail.calls[0].url)
  assert.equal(url.pathname, '/api/2.0/search')
  assert.equal(url.searchParams.get('type'), 'sales')
  assert.equal(url.searchParams.get('register_id'), SETTINGS.registerId)
  assert.equal(url.searchParams.get('date_from'), '2026-11-12')
})

test('second try: nothing there yet, so the sale is sent', async () => {
  const retail = fakeRetail({ status: 200, body: { data: [] } }, recorded(PAYLOAD))
  const result = await pushSale(ORDER, SETTINGS, retail.connection, 1)
  assert.deepEqual([result.ok, result.alreadyExisted], [true, false])
  assert.deepEqual(retail.calls.map((c) => c.method), ['GET', 'POST'])
})

test('second try: if the check itself fails, nothing is sent', async () => {
  for (const answer of [TIMEOUT, { status: 500, body: {} }, { status: 200, body: { nothing: true } }]) {
    const retail = fakeRetail(answer)
    const result = await pushSale(ORDER, SETTINGS, retail.connection, 2)
    assert.deepEqual([result.ok, result.retryable], [false, true])
    assert.equal(retail.calls.every((c) => c.method === 'GET'), true)
  }
})

test('second try: an existing sale that does not match is left for a person', async () => {
  const retail = fakeRetail({ status: 200, body: { data: [searchHit({ line_items: [] })] } })
  const result = await pushSale(ORDER, SETTINGS, retail.connection, 1)
  assert.deepEqual([result.ok, result.retryable, result.saleId], [false, false, id(5000)])
  assert.equal(retail.calls.length, 1)
})

test('a voided sale for the order does not count as already there', async () => {
  const retail = fakeRetail({ status: 200, body: { data: [searchHit({ state: 'voided' })] } })
  assert.deepEqual(await findSaleForOrder(retail.connection, 'W100001', SETTINGS.registerId, ORDER.paidAt), { found: false })
})

test('the search reads on through full pages', async () => {
  const filler = Array.from({ length: 200 }, (_, n) => ({ id: id(n), source_id: `other-${n}` }))
  const retail = fakeRetail({ status: 200, body: { data: filler } }, { status: 200, body: { data: [searchHit()] } })
  const result = await findSaleForOrder(retail.connection, 'W100001', SETTINGS.registerId, ORDER.paidAt)
  assert.equal(result.found, true)
  assert.deepEqual(retail.calls.map((c) => new URL(c.url).searchParams.get('offset')), ['0', '200'])
})

test('comparing a recorded sale with what was sent', () => {
  assert.equal(saleMismatch(recorded(PAYLOAD).body.register_sale, PAYLOAD), null)
  assert.equal(saleMismatch(searchHit(), PAYLOAD), null)
  assert.match(saleMismatch({}, PAYLOAD), /no sale id/)
  assert.match(saleMismatch(searchHit({ line_items: [...searchHit().line_items, { product_id: id(777), quantity: 1 }] }), PAYLOAD), /did not send/)
})

test('settings: sending is off until switched on, and needs the store’s Lightspeed details', () => {
  assert.throws(() => retailConnectionFromEnv({ LIGHTSPEED_DOMAIN_PREFIX: 'teststore', LIGHTSPEED_ACCESS_TOKEN: TOKEN }), RetailSalesNotEnabled)
  assert.throws(() => retailConnectionFromEnv({ RETAIL_SALES_ENABLED: 'true' }), RetailSalesNotEnabled)
  assert.throws(() => retailConnectionFromEnv({ RETAIL_SALES_ENABLED: 'true', LIGHTSPEED_DOMAIN_PREFIX: 'evil.example/x', LIGHTSPEED_ACCESS_TOKEN: TOKEN }), RetailSalesNotEnabled)
  assert.deepEqual(retailConnectionFromEnv({ RETAIL_SALES_ENABLED: 'true', LIGHTSPEED_DOMAIN_PREFIX: 'teststore', LIGHTSPEED_ACCESS_TOKEN: TOKEN }), { domainPrefix: 'teststore', accessToken: TOKEN })

  const settings = retailSaleSettingsFromEnv({ RETAIL_REGISTER_ID: id(1), RETAIL_USER_ID: id(2), RETAIL_PAYMENT_TYPE_ID: id(3), RETAIL_TAX_ID: id(4), RETAIL_NO_TAX_ID: id(5) })
  assert.deepEqual(settings, { registerId: id(1), userId: id(2), paymentTypeId: id(3), taxId: id(4), noTaxId: id(5), exemptTaxId: RETAIL_DEFAULTS.exemptTaxId, deliveryProductId: null, guestCustomerId: null })
  assert.equal(buildSalePayload(ORDER, settings).ok, true)

  // Nothing set: the owner's choices (Online register, Online payments, Broward tax,
  // No Tax, the resellers' exemption tax). Only the staff user is still to be chosen.
  const defaults = retailSaleSettingsFromEnv({})
  assert.deepEqual(defaults, { ...RETAIL_DEFAULTS, userId: '', deliveryProductId: null, guestCustomerId: null })
  assert.match(buildSalePayload(ORDER, defaults).error, /RETAIL_USER_ID/)
  assert.equal(buildSalePayload(ORDER, retailSaleSettingsFromEnv({ RETAIL_USER_ID: id(2) })).ok, true)
})
