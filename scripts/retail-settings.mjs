// Lists what Lightspeed Retail (X-Series) has to choose from for website
// orders: outlets, registers, staff users, payment types and taxes. Pick one
// of each and put its id in .env.local (the README says which name goes with
// which).
//
//   node scripts/retail-settings.mjs            staff shown by id and role only
//   node scripts/retail-settings.mjs --names    also show staff names
//
// Read-only: it uses the importer's client, which refuses anything but GET.
// Nothing is saved to disk. No customer data is read.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { retailAll } from './lib/lightspeed.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const envFile = path.join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const showNames = process.argv.includes('--names')
const live = (rows) => rows.filter((row) => !row.deleted_at)
const say = (text = '') => console.log(text)

/** Prints a section: a heading, the setting it is for, then one line per row. */
function section(title, setting, rows, describe) {
  say()
  say(`${title}  ->  ${setting}`)
  if (rows.length === 0) say('  (none)')
  for (const row of rows) say(`  ${row.id}  ${describe(row)}`)
}

let outlets, registers, users, paymentTypes, taxes
try {
  outlets = live(await retailAll('outlets'))
  registers = live(await retailAll('registers'))
  users = live(await retailAll('users'))
  paymentTypes = live(await retailAll('payment_types'))
  taxes = live(await retailAll('taxes'))
} catch (error) {
  console.error(`Could not read Lightspeed Retail: ${error?.message ?? error}`)
  process.exit(1)
}

const outletName = new Map(outlets.map((outlet) => [outlet.id, outlet.name]))

say('Lightspeed Retail: choices for website orders (read-only listing)')

section('Outlets', 'for information; a register belongs to one outlet', outlets, (outlet) => {
  const tax = taxes.find((t) => t.id === outlet.default_tax_id)
  return `${outlet.name}${tax ? `   default tax: ${tax.name}` : ''}`
})

section('Registers', 'RETAIL_REGISTER_ID', registers, (register) => {
  const open = register.is_open ? 'open now' : 'closed now'
  return `${register.name}   outlet: ${outletName.get(register.outlet_id) ?? register.outlet_id}   ${open}`
})

section('Staff users', 'RETAIL_USER_ID', users, (user) => {
  const role = [user.account_type, user.is_primary_user ? 'primary user' : null].filter(Boolean).join(', ')
  return showNames ? `${user.display_name ?? user.username ?? ''}   ${role}` : `(${role || 'user'})   run with --names to see who this is`
})

section('Payment types', 'RETAIL_PAYMENT_TYPE_ID', paymentTypes, (type) => `${type.name}${type.payment_type_id != null ? `   kind ${type.payment_type_id}` : ''}`)

section('Taxes', 'RETAIL_TAX_ID (charged)  and  RETAIL_NO_TAX_ID (tax-exempt customers, untaxed goods)', taxes, (tax) => {
  const rates = Array.isArray(tax.rates) ? tax.rates.map((rate) => `${rate.name ?? 'rate'} ${(Number(rate.rate) * 100).toFixed(4).replace(/\.?0+$/, '')}%`).join(' + ') : ''
  const total = Array.isArray(tax.rates) ? tax.rates.reduce((sum, rate) => sum + Number(rate.rate || 0), 0) : Number(tax.rate || 0)
  return `${tax.name}   ${(total * 100).toFixed(4).replace(/\.?0+$/, '')}%${tax.is_default ? '   (default)' : ''}${rates && tax.rates.length > 1 ? `   = ${rates}` : ''}`
})

say()
say('The website should charge the same rate as the tax chosen for RETAIL_TAX_ID: put that percent in SALES_TAX_RATE_PERCENT.')
