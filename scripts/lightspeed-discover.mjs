// Phase 0 of the standalone store: looks at what the Lightspeed eCom (Ecwid)
// store holds, so the local schema and importer are built on facts.
//
//   node scripts/lightspeed-discover.mjs [--skip-orders] [--max-orders=5000]
//
// Read-only: the client below refuses anything but GET. It changes nothing in
// Lightspeed, in this repo or in the database. Raw answers are saved as JSON
// in LIGHTSPEED_DUMP_DIR (default %LOCALAPPDATA%\WoodysPaper\lightspeed-dump),
// which must stay outside the repo and OneDrive: the files hold customer data.
// The printed report names customers by Lightspeed id only.
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const envFile = path.join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const storeId = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID
const token = process.env.LIGHTSPEED_SECRET_TOKEN
if (!storeId || !token) {
  console.error('Set NEXT_PUBLIC_LIGHTSPEED_STORE_ID and LIGHTSPEED_SECRET_TOKEN in .env.local.')
  process.exit(1)
}

const args = process.argv.slice(2)
const skipOrders = args.includes('--skip-orders')
const maxOrders = Number(args.find((a) => a.startsWith('--max-orders='))?.split('=')[1] ?? 5000)

const dumpDir =
  process.env.LIGHTSPEED_DUMP_DIR ||
  path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'WoodysPaper', 'lightspeed-dump')
if (path.resolve(dumpDir).startsWith(path.resolve(root))) {
  console.error('LIGHTSPEED_DUMP_DIR must be outside the repo.')
  process.exit(1)
}
await mkdir(dumpDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lines = []
const say = (text = '') => {
  lines.push(text)
  console.log(text)
}

/** GET only. Returns { status, body }; body is null unless the answer was 200. */
async function get(resource, params = {}) {
  const url = new URL(`https://app.ecwid.com/api/v3/${storeId}/${resource}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  for (let attempt = 1; ; attempt++) {
    await sleep(250)
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      if (attempt >= 4) return { status: 0, body: null, error: String(error?.message ?? error) }
      await sleep(1000 * attempt)
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const wait = Number(response.headers.get('retry-after')) || 2 * attempt
      await sleep(wait * 1000)
      continue
    }
    if (!response.ok) return { status: response.status, body: null }
    return { status: 200, body: await response.json() }
  }
}

/** Reads every page of a list endpoint ({ total, items }). */
async function getAll(resource, params = {}, cap = Infinity) {
  const items = []
  let total = null
  for (let offset = 0; offset < cap; offset += 100) {
    const { status, body, error } = await get(resource, { ...params, offset, limit: 100 })
    if (status !== 200) return { status, error, total, items }
    const page = Array.isArray(body) ? body : (body.items ?? [])
    total = Array.isArray(body) ? page.length : (body.total ?? total)
    items.push(...page)
    if (Array.isArray(body) || page.length < 100 || (total != null && items.length >= total)) break
  }
  return { status: 200, total: total ?? items.length, items }
}

const save = (name, data) => writeFile(path.join(dumpDir, `${name}.json`), JSON.stringify(data, null, 1))

function keyCounts(items) {
  const counts = new Map()
  for (const item of items) {
    for (const [key, value] of Object.entries(item ?? {})) {
      const filled = !(value == null || value === '' || (Array.isArray(value) && value.length === 0))
      const entry = counts.get(key) ?? { present: 0, filled: 0 }
      entry.present++
      if (filled) entry.filled++
      counts.set(key, entry)
    }
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]))
}

function tally(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

const show = (pairs, limit = 25) =>
  pairs
    .slice(0, limit)
    .map(([key, count]) => `${key} (${count})`)
    .join(', ') + (pairs.length > limit ? `, … ${pairs.length - limit} more` : '')

const access = []
function note(name, result) {
  const ok = result.status === 200
  access.push(`${ok ? 'OK ' : 'NO '} ${name}: ${ok ? `${result.total ?? 'read'}` : `HTTP ${result.status}${result.error ? ` ${result.error}` : ''}`}`)
  return ok
}

say(`Lightspeed eCom discovery — store ${storeId} — ${new Date().toISOString()}`)
say(`Raw JSON: ${dumpDir}`)

// ---- Store profile, tax, shipping -----------------------------------------
const profile = await get('profile')
if (note('profile', profile)) await save('profile', profile.body)
const shipping = await get('profile/shippingOptions')
if (note('profile/shippingOptions', shipping)) await save('shippingOptions', shipping.body)
const payment = await get('profile/paymentOptions')
if (note('profile/paymentOptions', payment)) await save('paymentOptions', payment.body)

// ---- Catalog ---------------------------------------------------------------
const categories = await getAll('categories')
if (note('categories', categories)) await save('categories', categories.items)
const products = await getAll('products')
if (note('products', products)) await save('products', products.items)
const classes = await get('classes')
if (note('classes (product types)', classes)) await save('classes', classes.body)

// ---- Customers and pricing -------------------------------------------------
const customers = await getAll('customers')
if (note('customers', customers)) await save('customers', customers.items)
const groups = await getAll('customer_groups')
if (note('customer_groups', groups)) await save('customer_groups', groups.items)
const promotions = await getAll('promotions')
if (note('promotions', promotions)) await save('promotions', promotions.items)
const coupons = await getAll('discount_coupons')
if (note('discount_coupons', coupons)) await save('discount_coupons', coupons.items)

// ---- Orders ----------------------------------------------------------------
let orders = { status: -1, items: [], total: 0 }
if (!skipOrders) {
  orders = await getAll('orders', {}, maxOrders)
  if (note('orders', orders)) await save('orders', orders.items)
}

say('\n== Access (token scopes) ==')
access.forEach((line) => say(line))

if (profile.body) {
  const p = profile.body
  say('\n== Store ==')
  say(`Currency ${p.formatsAndUnits?.currency}; weight unit ${p.formatsAndUnits?.weightUnit}; country ${p.company?.countryCode} ${p.company?.stateOrProvinceCode ?? ''}`)
  const tax = p.taxSettings ?? {}
  say('\n== Tax ==')
  say(`automaticTaxEnabled=${tax.automaticTaxEnabled}; pricesIncludeTax=${tax.pricesIncludeTax}; taxExemptBusiness=${tax.taxExemptBusiness}; taxOnShippingCalculationScheme=${tax.taxOnShippingCalculationScheme}`)
  for (const t of tax.taxes ?? []) {
    say(`  manual tax "${t.name}": enabled=${t.enabled} includeInPrice=${t.includeInPrice} appliedByDefault=${t.appliedByDefault} defaultTax=${t.defaultTax} useShippingAddress=${t.useShippingAddress} taxShipping=${t.taxShipping} rules=${(t.rules ?? []).length}`)
    for (const rule of (t.rules ?? []).slice(0, 15)) say(`    zone ${rule.zoneId}: ${rule.tax}%`)
  }
  say(`Zones defined: ${(p.zones ?? []).length} — ${(p.zones ?? []).map((z) => `${z.name}[${z.id}]`).join(', ')}`)
}

if (shipping.body) {
  say('\n== Shipping methods ==')
  for (const s of shipping.body) {
    const flat = s.flatRate ? ` flat=${s.flatRate.rateType}:${s.flatRate.rate}` : ''
    const table = s.ratesTable ? ` table=${s.ratesTable.tableBasedOn} tiers=${(s.ratesTable.rates ?? []).length}` : ''
    say(`  "${s.title}" enabled=${s.enabled} fulfilment=${s.fulfilmentType ?? s.fulfillmentType} calc=${s.ratesCalculationType ?? '-'} carrier=${s.carrier ?? '-'} zone=${s.destinationZone?.name ?? '-'}${flat}${table}`)
  }
}
if (payment.body) {
  say('\n== Payment methods (for reference) ==')
  for (const m of payment.body) say(`  "${m.checkoutTitle}" enabled=${m.enabled} processor=${m.paymentProcessorTitle ?? m.paymentProcessorId ?? '-'}`)
}

if (categories.items.length) {
  const list = categories.items
  say('\n== Categories ==')
  say(`Total ${list.length}; top-level ${list.filter((c) => !c.parentId).length}; disabled ${list.filter((c) => c.enabled === false).length}; with image ${list.filter((c) => c.imageUrl || c.thumbnailUrl).length}`)
}

const priceBySku = new Map()
const priceByProductId = new Map()
if (products.items.length) {
  const list = products.items
  say('\n== Products ==')
  say(`Total ${list.length}; enabled ${list.filter((p) => p.enabled).length}; in stock ${list.filter((p) => p.inStock).length}; unlimited stock ${list.filter((p) => p.unlimited).length}`)
  const withCombos = list.filter((p) => (p.combinations ?? []).length > 0)
  const combos = withCombos.flatMap((p) => p.combinations)
  say(`With variants (combinations) ${withCombos.length}; variants in all ${combos.length}; with options ${list.filter((p) => (p.options ?? []).length).length}`)
  say(`SKU ending " - Base": ${list.filter((p) => / - Base$/i.test(p.sku ?? '')).length}; of those with variants: ${withCombos.filter((p) => / - Base$/i.test(p.sku ?? '')).length}; products without SKU ${list.filter((p) => !p.sku).length}`)
  const skus = tally(list.map((p) => p.sku).concat(combos.map((c) => c.sku)).filter(Boolean))
  say(`Duplicate SKUs (products + variants): ${skus.filter(([, n]) => n > 1).length}`)
  say(`Option names: ${show(tally(list.flatMap((p) => (p.options ?? []).map((o) => `${o.name}/${o.type}`))))}`)
  say(`Options with price modifiers: ${list.filter((p) => (p.options ?? []).some((o) => (o.choices ?? []).some((c) => c.priceModifier))).length} products`)
  say(`Attribute names: ${show(tally(list.flatMap((p) => (p.attributes ?? []).filter((a) => a.value).map((a) => a.name))))}`)
  say(`Brand values: ${tally(list.flatMap((p) => (p.attributes ?? []).filter((a) => a.name === 'Brand' && a.value).map((a) => a.value))).length} distinct`)
  say(`Bulk price tiers (wholesalePrices): ${list.filter((p) => (p.wholesalePrices ?? []).length).length} products; compareToPrice set: ${list.filter((p) => p.compareToPrice).length}; costPrice set: ${list.filter((p) => p.costPrice).length}`)
  say(`Variants with own price: ${combos.filter((c) => c.price != null).length}; own stock: ${combos.filter((c) => c.quantity != null).length}; own image: ${combos.filter((c) => c.imageUrl).length}; own wholesalePrices: ${combos.filter((c) => (c.wholesalePrices ?? []).length).length}`)
  const images = list.map((p) => (p.media?.images ?? []).length || (p.imageUrl ? 1 + (p.galleryImages ?? []).length : 0))
  say(`Images: ${images.reduce((a, b) => a + b, 0)} in all; products without image ${images.filter((n) => n === 0).length}; most on one product ${Math.max(...images)}`)
  say(`Weight set: ${list.filter((p) => p.weight).length}; requires shipping false: ${list.filter((p) => p.isShippingRequired === false).length}; tax classes: ${show(tally(list.map((p) => p.tax?.taxClassCode ?? (p.tax?.taxable === false ? 'not taxable' : 'default'))))}`)
  say(`Categories per product: ${show(tally(list.map((p) => (p.categoryIds ?? []).length)))}`)
  const groupPriceKeys = keyCounts(list).filter(([key]) => /group|tier|pricelist|customerPrice|member/i.test(key))
  say(`Product fields that look like customer-group pricing: ${groupPriceKeys.length ? groupPriceKeys.map(([k, v]) => `${k} (filled ${v.filled})`).join(', ') : 'none'}`)
  say(`All product fields (filled/present): ${keyCounts(list).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
  if (combos.length) say(`All variant fields: ${keyCounts(combos).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
  for (const p of list) {
    priceByProductId.set(p.id, p.price)
    if (p.sku) priceBySku.set(p.sku, p.price)
    for (const c of p.combinations ?? []) if (c.sku) priceBySku.set(c.sku, c.price ?? c.defaultDisplayedPrice ?? p.price)
  }
}

if (customers.items.length) {
  const list = customers.items
  say('\n== Customers ==')
  const emails = tally(list.map((c) => (c.email ?? '').trim().toLowerCase()).filter(Boolean))
  say(`Total ${list.length}; without email ${list.filter((c) => !c.email).length}; emails used more than once ${emails.filter(([, n]) => n > 1).length}`)
  say(`With POS id (externalReferenceId) ${list.filter((c) => c.externalReferenceId).length}; tax exempt ${list.filter((c) => c.taxExempt).length}; with tax id ${list.filter((c) => c.taxId).length}; with company ${list.filter((c) => c.billingPerson?.companyName).length}; with shipping address ${list.filter((c) => (c.shippingAddresses ?? []).length).length}`)
  say(`Groups: ${show(tally(list.map((c) => `${c.customerGroupName ?? 'General'}[${c.customerGroupId ?? 0}]`)))}`)
  say(`All customer fields (filled/present): ${keyCounts(list).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
}

if (groups.items.length) {
  say('\n== Customer groups ==')
  for (const g of groups.items) say(`  [${g.id}] ${g.name} — fields: ${Object.keys(g).join(', ')}`)
}

if (promotions.items.length) {
  say('\n== Promotions ==')
  for (const p of promotions.items) {
    const t = p.triggers ?? {}
    const target = p.targets ?? {}
    say(`  [${p.id}] "${p.name}" enabled=${p.enabled} ${p.discountBase ?? ''} ${p.discountType} ${p.amount} groups=${JSON.stringify(t.customerGroups ?? [])} subtotal=${t.subtotal ?? '-'} dates=${t.startDate ?? '-'}..${t.endDate ?? '-'} targets: categories=${(target.categories ?? []).length} products=${(target.products ?? []).length}`)
  }
}
if (coupons.status === 200) say(`\n== Discount coupons ==\nTotal ${coupons.items.length}; active ${coupons.items.filter((c) => c.status === 'ACTIVE').length}`)

if (orders.items.length) {
  const list = orders.items
  say('\n== Orders ==')
  const dates = list.map((o) => o.createDate).filter(Boolean).sort()
  const numbers = list.map((o) => Number(o.orderNumber ?? o.internalId ?? 0)).filter(Number.isFinite)
  say(`Read ${list.length} of ${orders.total}; from ${dates[0]} to ${dates.at(-1)}; highest order number ${Math.max(...numbers)}; sample id "${list[0].id}"`)
  say(`Payment status: ${show(tally(list.map((o) => o.paymentStatus)))}`)
  say(`Fulfilment status: ${show(tally(list.map((o) => o.fulfillmentStatus)))}`)
  say(`Payment methods: ${show(tally(list.map((o) => o.paymentMethod)))}`)
  say(`Shipping methods used: ${show(tally(list.map((o) => o.shippingOption?.shippingMethodName ?? '(none)')))}`)
  say(`Guest orders (no customerId): ${list.filter((o) => !o.customerId).length}; with customer group: ${show(tally(list.map((o) => o.customerGroup ?? '(none)')))}`)
  say(`Orders with tax > 0: ${list.filter((o) => o.tax > 0).length}; tax exempt flag: ${list.filter((o) => o.customerTaxExempt).length}; with order-level discount: ${list.filter((o) => o.discount > 0).length}; with coupon: ${list.filter((o) => o.couponDiscount > 0).length}; with volumeDiscount: ${list.filter((o) => o.volumeDiscount > 0).length}; with membershipBasedDiscount: ${list.filter((o) => o.membershipBasedDiscount > 0).length}`)
  say(`Discount descriptions: ${show(tally(list.flatMap((o) => (o.discountInfo ?? []).map((d) => `${d.base ?? ''}/${d.type ?? ''}/${d.value ?? ''}${d.description ? `/${d.description}` : ''}`))), 20)}`)

  // Negotiated prices: lines whose unit price differs from the product's base
  // price on the order (productPrice), or from today's list price for the SKU.
  const perCustomer = new Map()
  let linesTotal = 0
  let linesOffBase = 0
  let linesOffToday = 0
  let linesWithItemDiscount = 0
  for (const order of list) {
    for (const item of order.items ?? []) {
      linesTotal++
      const hasOptions = (item.selectedOptions ?? []).length > 0
      const offBase = item.productPrice != null && !hasOptions && Math.abs(item.price - item.productPrice) > 0.005
      const today = priceBySku.get(item.sku) ?? priceByProductId.get(item.productId)
      const offToday = today != null && Math.abs(item.price - today) > 0.005
      if (offBase) linesOffBase++
      if (offToday) linesOffToday++
      if ((item.discounts ?? []).length) linesWithItemDiscount++
      const key = order.customerId ?? 'guest'
      const entry = perCustomer.get(key) ?? { lines: 0, offBase: 0, offToday: 0, below: 0, group: order.customerGroup ?? '' }
      entry.lines++
      if (offBase) entry.offBase++
      if (offToday) entry.offToday++
      if (today != null && item.price < today - 0.005) entry.below++
      perCustomer.set(key, entry)
    }
  }
  say('\n== Negotiated-price scan (order lines) ==')
  say(`Lines ${linesTotal}; unit price differs from the order's own base price (no options): ${linesOffBase}; differs from today's list price: ${linesOffToday}; lines carrying item-level discounts: ${linesWithItemDiscount}`)
  const ranked = [...perCustomer].filter(([, e]) => e.offBase || e.below).sort((a, b) => b[1].offBase - a[1].offBase || b[1].below - a[1].below)
  say(`Customers with at least one such line: ${ranked.length}. Top 15 (Lightspeed customer id: lines / off base / below today's list / group):`)
  for (const [id, e] of ranked.slice(0, 15)) say(`  ${id}: ${e.lines} / ${e.offBase} / ${e.below} / ${e.group || '-'}`)
  const itemKeys = keyCounts(list.flatMap((o) => o.items ?? []))
  say(`Order line fields: ${itemKeys.map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
  say(`Order fields: ${keyCounts(list).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
}

await writeFile(path.join(dumpDir, 'report.txt'), lines.join('\n'))
say(`\nReport saved to ${path.join(dumpDir, 'report.txt')}`)
