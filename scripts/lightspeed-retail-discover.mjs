// Phase 0, part 2: looks at what the Lightspeed Retail (X-Series) POS holds —
// customers, customer groups, price books — because the eCom store has the
// catalog but only one customer and no negotiated prices.
//
//   node scripts/lightspeed-retail-discover.mjs [--with-sales]
//
// Read-only: the client below refuses anything but GET. Raw answers are saved
// as JSON in LIGHTSPEED_DUMP_DIR\retail (default
// %LOCALAPPDATA%\WoodysPaper\lightspeed-dump\retail), outside the repo and
// OneDrive: the files hold customer data. The printed report names customers
// by id only.
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const envFile = path.join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const prefix = process.env.LIGHTSPEED_DOMAIN_PREFIX
const token = process.env.LIGHTSPEED_ACCESS_TOKEN
if (!prefix || !token) {
  console.error('Set LIGHTSPEED_DOMAIN_PREFIX and LIGHTSPEED_ACCESS_TOKEN in .env.local.')
  process.exit(1)
}
if (!/^[a-z0-9-]+$/i.test(prefix)) {
  console.error('LIGHTSPEED_DOMAIN_PREFIX must be just the store subdomain.')
  process.exit(1)
}
const withSales = process.argv.includes('--with-sales')

const dumpDir = path.join(
  process.env.LIGHTSPEED_DUMP_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'WoodysPaper', 'lightspeed-dump'),
  'retail',
)
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

/** GET only. Returns { status, body }. */
async function get(apiPath, params = {}) {
  const url = new URL(`https://${prefix}.retail.lightspeed.app/api/${apiPath}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  for (let attempt = 1; ; attempt++) {
    await sleep(300)
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      if (attempt >= 4) return { status: 0, body: null, error: String(error?.message ?? error) }
      await sleep(1500 * attempt)
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = Number(retryAfter)
      const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 3000 * attempt
      await sleep(Math.min(wait || 3000, 120_000))
      continue
    }
    if (!response.ok) return { status: response.status, body: null }
    const text = await response.text()
    try {
      return { status: 200, body: JSON.parse(text) }
    } catch {
      return { status: 200, body: null, error: 'not JSON' }
    }
  }
}

/** Reads every page of an API 2.0 collection ({ data, version: { max } }). */
async function getAll(resource, params = {}, cap = 500_000) {
  const items = []
  let after = 0
  while (items.length < cap) {
    const { status, body, error } = await get(`2.0/${resource}`, { ...params, after, page_size: 1000 })
    if (status !== 200 || !body) return { status: status === 200 ? -1 : status, error, items }
    const page = body.data ?? []
    if (!Array.isArray(page)) return { status: 200, items: [page], single: true }
    if (page.length === 0) break
    items.push(...page)
    const max = body.version?.max
    if (max == null || max === after) break
    after = max
  }
  return { status: 200, items }
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
const fields = (items) => keyCounts(items).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')

function tally(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}
const show = (pairs, limit = 30) =>
  pairs.slice(0, limit).map(([key, count]) => `${key} (${count})`).join(', ') + (pairs.length > limit ? `, … ${pairs.length - limit} more` : '')

say(`Lightspeed Retail (X-Series) discovery — ${new Date().toISOString()}`)
say(`Raw JSON: ${dumpDir}`)

const resources = [
  'outlets', 'taxes', 'brands', 'product_types', 'suppliers', 'tags',
  'customer_groups', 'customers', 'price_books', 'price_book_products',
  'products', 'inventory', 'users', 'payment_types', 'promotions',
]
if (withSales) resources.push('sales')

const data = {}
say('\n== Access ==')
for (const resource of resources) {
  const result = await getAll(resource)
  data[resource] = result.items
  if (result.status === 200) await save(resource, result.items)
  say(`${result.status === 200 ? 'OK ' : 'NO '} ${resource}: ${result.status === 200 ? result.items.length : `HTTP ${result.status}${result.error ? ` ${result.error}` : ''}`}`)
}

const live = (items) => items.filter((item) => !item.deleted_at)

if (data.outlets.length) {
  say('\n== Outlets ==')
  for (const o of data.outlets) say(`  [${o.id}] ${o.name} — default tax ${o.default_tax_id ?? '-'}; ${o.physical_city ?? ''} ${o.physical_state ?? ''}`)
}
if (data.taxes.length) {
  say('\n== Taxes ==')
  for (const t of live(data.taxes)) say(`  [${t.id}] ${t.name}: ${t.rate ?? (t.rates ?? []).map((r) => `${r.name} ${r.rate}`).join(' + ')}${t.is_default ? ' (default)' : ''}`)
}

const groups = live(data.customer_groups)
const groupName = new Map(groups.map((g) => [g.id, g.name]))
if (groups.length) {
  say('\n== Customer groups ==')
  say(`Total ${groups.length} (deleted ${data.customer_groups.length - groups.length}). Fields: ${fields(groups)}`)
}

const customers = live(data.customers)
if (data.customers.length) {
  say('\n== Customers ==')
  const emails = tally(customers.map((c) => (c.email ?? '').trim().toLowerCase()).filter(Boolean))
  say(`Total ${customers.length} (deleted ${data.customers.length - customers.length}); without email ${customers.filter((c) => !c.email).length}; emails used more than once ${emails.filter(([, n]) => n > 1).length}`)
  say(`With company ${customers.filter((c) => c.company_name).length}; with customer_code ${customers.filter((c) => c.customer_code).length}; on account enabled ${customers.filter((c) => c.enable_loyalty === false || c.on_account_limit != null).length}; with balance ${customers.filter((c) => Number(c.balance) !== 0 && c.balance != null).length}; with physical address ${customers.filter((c) => c.physical_address_1 || c.physical_address1).length}; with postal address ${customers.filter((c) => c.postal_address_1 || c.postal_address1).length}`)
  say(`By group: ${show(tally(customers.map((c) => groupName.get(c.customer_group_id) ?? `(unknown ${c.customer_group_id})`)), 90)}`)
  const multiGroup = customers.filter((c) => (c.customer_group_ids ?? []).length > 1).length
  say(`Customers in more than one group: ${multiGroup}`)
  say(`Fields: ${fields(customers)}`)
}

const books = live(data.price_books)
if (data.price_books.length) {
  say('\n== Price books ==')
  say(`Total ${books.length} (deleted ${data.price_books.length - books.length}). Fields: ${fields(books)}`)
  const lineCount = tally(data.price_book_products.filter((p) => !p.deleted_at).map((p) => p.price_book_id))
  const linesByBook = new Map(lineCount)
  for (const b of books) {
    say(`  [${b.id}] "${b.name}" group=${groupName.get(b.customer_group_id) ?? b.customer_group_id ?? '-'} outlet=${b.outlet_id ?? 'all'} valid=${b.valid_from ?? '-'}..${b.valid_to ?? '-'} restrict=${b.restrict_to_platform ?? '-'} lines=${linesByBook.get(b.id) ?? 0}`)
  }
}
const bookLines = data.price_book_products.filter((p) => !p.deleted_at)
if (data.price_book_products.length) {
  say('\n== Price book lines ==')
  say(`Total ${bookLines.length} (deleted ${data.price_book_products.length - bookLines.length}); distinct products ${new Set(bookLines.map((p) => p.product_id)).size}; with quantity breaks ${bookLines.filter((p) => p.min_units != null || p.max_units != null).length}`)
  say(`Fields: ${fields(bookLines)}`)
}

const products = live(data.products)
if (data.products.length) {
  say('\n== Products ==')
  say(`Total ${products.length} (deleted ${data.products.length - products.length}); active ${products.filter((p) => p.is_active ?? p.active).length}; variant children ${products.filter((p) => p.variant_parent_id).length}; with variants ${products.filter((p) => p.has_variants).length}; composites ${products.filter((p) => p.is_composite).length}`)
  say(`Without SKU ${products.filter((p) => !p.sku).length}; duplicate SKUs ${tally(products.map((p) => p.sku).filter(Boolean)).filter(([, n]) => n > 1).length}; sold online (ecwid/ecommerce flag) ${products.filter((p) => p.ecwid_enabled_webstore || p.is_ecommerce).length}`)
  say(`Price fields present: ${keyCounts(products).filter(([k]) => /price|cost|tax/i.test(k)).map(([k, v]) => `${k} ${v.filled}/${v.present}`).join('; ')}`)
  say(`Fields: ${fields(products)}`)
}

if (data.inventory.length) {
  const inv = data.inventory
  say('\n== Inventory ==')
  say(`Rows ${inv.length}; outlets ${new Set(inv.map((i) => i.outlet_id)).size}; rows with stock > 0: ${inv.filter((i) => Number(i.inventory_level ?? i.current_amount) > 0).length}; negative: ${inv.filter((i) => Number(i.inventory_level ?? i.current_amount) < 0).length}`)
  say(`Fields: ${fields(inv)}`)
}

for (const name of ['brands', 'product_types', 'suppliers', 'tags', 'payment_types', 'promotions', 'users']) {
  if (data[name]?.length) say(`\n== ${name} ==\n${live(data[name]).length} live. Fields: ${fields(data[name].slice(0, 200))}`)
}

if (withSales && data.sales?.length) {
  const sales = data.sales
  say('\n== Sales ==')
  const dates = sales.map((s) => s.sale_date ?? s.created_at).filter(Boolean).sort()
  say(`Total ${sales.length}; from ${dates[0]} to ${dates.at(-1)}; with customer ${sales.filter((s) => s.customer_id).length}; status: ${show(tally(sales.map((s) => s.status)))}; source: ${show(tally(sales.map((s) => s.source ?? '-')))}`)
  say(`Fields: ${fields(sales.slice(0, 500))}`)
}

await writeFile(path.join(dumpDir, 'report.txt'), lines.join('\n'))
say(`\nReport saved to ${path.join(dumpDir, 'report.txt')}`)
