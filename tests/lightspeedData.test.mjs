import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEcwidDate, promotionsForGroup, toCustomerRecord } from '../src/server/lightspeedData.ts'

const NOW = new Date('2026-11-11T12:00:00Z')

const customer = {
  id: 1001,
  externalReferenceId: 'pos-77',
  email: 'Pat@Example.com',
  registered: '2026-09-01 14:30:00 +0000',
  updated: '2026-11-01 09:00:00 +0000',
  billingPerson: {
    name: 'Pat Doe',
    firstName: 'Pat',
    lastName: 'Doe',
    companyName: 'Doe Supply',
    street: '1 Main St',
    city: 'Miami',
    countryCode: 'US',
    postalCode: '33101',
    stateOrProvinceCode: 'FL',
    phone: '555-0100',
  },
  shippingAddresses: [{ id: 1, city: 'Miami' }],
  contacts: [{ id: 2, type: 'EMAIL' }],
  customerGroupId: 500,
  customerGroupName: 'TIER1',
  taxExempt: true,
  taxId: '12-345',
  b2b_b2c: 'b2b',
  acceptMarketing: false,
  lang: 'en',
  stats: { numberOfOrders: 12, numberOfCanceledOrders: 1, salesValue: 3456.78, averageOrderValue: 288.07 },
  privateAdminNotes: 'net 30',
}

const promotions = [
  { id: 1, name: 'TIER 1 WHOLESALE', description: '28% OFF LIST', enabled: true, discountType: 'PERCENT', amount: 28, triggers: { startDate: '2026-10-01 04:00:00 +0000', customerGroups: [500] } },
  { id: 2, name: 'Small extra', enabled: true, discountType: 'PERCENT', amount: 5, triggers: { customerGroups: [500, 600] } },
  { id: 3, name: 'Other group', enabled: true, discountType: 'PERCENT', amount: 40, triggers: { customerGroups: [600] } },
  { id: 4, name: 'Switched off', enabled: false, discountType: 'PERCENT', amount: 50, triggers: { customerGroups: [500] } },
  { id: 5, name: 'Not started', enabled: true, discountType: 'PERCENT', amount: 60, triggers: { startDate: '2027-01-01 00:00:00 +0000', customerGroups: [500] } },
  { id: 6, name: 'Ended', enabled: true, discountType: 'PERCENT', amount: 70, triggers: { endDate: '2026-01-01 00:00:00 +0000', customerGroups: [500] } },
  { id: 7, name: 'Dollars off', enabled: true, discountType: 'ABS', amount: 99, triggers: { customerGroups: [500] } },
  { id: 8, name: 'Everyone', enabled: true, discountType: 'PERCENT', amount: 90, triggers: {} },
]

test('Lightspeed dates are read as UTC', () => {
  assert.equal(parseEcwidDate('2026-10-01 04:00:00 +0000').toISOString(), '2026-10-01T04:00:00.000Z')
  assert.equal(parseEcwidDate('2026-10-01 04:00:00 -0400').toISOString(), '2026-10-01T08:00:00.000Z')
  assert.equal(parseEcwidDate('2026-10-01 04:00:00').toISOString(), '2026-10-01T04:00:00.000Z')
  for (const bad of ['', 'not a date', null, undefined, 42]) assert.equal(parseEcwidDate(bad), null)
})

test('only promotions that are on, in date and aimed at the group apply', () => {
  assert.deepEqual(promotionsForGroup(promotions, 500, NOW).map((p) => p.id), [1, 2, 7])
  assert.deepEqual(promotionsForGroup(promotions, 600, NOW).map((p) => p.id), [2, 3])
  assert.deepEqual(promotionsForGroup(promotions, null, NOW), [])
  assert.deepEqual(promotionsForGroup(promotions, 0, NOW), [])
})

test('a customer maps to the saved row, with the group’s best percent discount', () => {
  const row = toCustomerRecord(customer, promotions, NOW)
  assert.equal(row.ecwidCustomerId, 1001)
  assert.equal(row.email, 'pat@example.com')
  assert.equal(row.name, 'Pat Doe')
  assert.equal(row.companyName, 'Doe Supply')
  assert.equal(row.stateCode, 'FL')
  assert.equal(row.customerGroupId, 500)
  assert.equal(row.customerGroupName, 'TIER1')
  assert.equal(row.discountPercent, 28)
  assert.equal(row.discountName, 'TIER 1 WHOLESALE')
  assert.equal(row.discountDescription, '28% OFF LIST')
  assert.equal(row.taxExempt, true)
  assert.equal(row.customerType, 'b2b')
  assert.equal(row.acceptMarketing, false)
  assert.equal(row.orderCount, 12)
  assert.equal(row.salesValue, 3456.78)
  assert.equal(row.registeredAt.toISOString(), '2026-09-01T14:30:00.000Z')
  assert.deepEqual(JSON.parse(row.shippingAddressesJson), [{ id: 1, city: 'Miami' }])
  assert.deepEqual(JSON.parse(row.promotionsJson).map((p) => p.id), [1, 2, 7])
  // The raw copy keeps fields that have no column of their own.
  assert.equal(JSON.parse(row.rawJson).privateAdminNotes, 'net 30')
})

test('a customer with no group has no group or discount', () => {
  const row = toCustomerRecord({ id: 7, email: 'x@example.com', customerGroupId: 0, customerGroupName: 'General' }, promotions, NOW)
  assert.equal(row.customerGroupId, null)
  assert.equal(row.customerGroupName, null)
  assert.equal(row.discountPercent, null)
  assert.equal(row.promotionsJson, '[]')
  assert.equal(row.name, null)
  assert.equal(row.orderCount, null)
  assert.equal(row.shippingAddressesJson, '[]')
})

test('over-long or blank text is cut or stored as null, and a missing id is an error', () => {
  const row = toCustomerRecord({ id: 8, billingPerson: { name: 'x'.repeat(500), phone: '   ' } }, [], NOW)
  assert.equal(row.name.length, 200)
  assert.equal(row.phone, null)
  assert.throws(() => toCustomerRecord({ email: 'x@example.com' }, [], NOW))
})
