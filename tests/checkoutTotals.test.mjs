import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeTotals, deliveryOptions, formatCents, normalizeZip } from '../src/server/checkout/totals.ts'

const SETTINGS = {
  taxRatePercent: 7,
  localZips: ['33312', '33314', '33004-1234'],
  localDeliveryMinimumCents: 20000,
  localDeliveryFeeCents: 0,
  deliveryTaxable: false,
}

const line = (unitPrice, quantity = 1, extra = {}) => ({ unitPrice, quantity, taxable: true, weightLb: 2, ...extra })

/** Totals for a cart, with pickup and a guest unless told otherwise. */
const totals = (lines, extra = {}) => computeTotals({ lines, delivery: 'pickup', taxExempt: false, settings: SETTINGS, ...extra })

const option = (result, method) => result.options.find((o) => o.method === method)

test('a guest picking up pays the subtotal plus tax, and nothing for delivery', () => {
  const result = totals([line('10.00', 3), line('4.25', 2)])
  assert.equal(result.ok, true)
  assert.equal(result.subtotalCents, 3850)
  assert.equal(result.deliveryCents, 0)
  assert.equal(result.taxableCents, 3850)
  assert.equal(result.taxCents, 270) // 38.50 x 7% = 2.695 -> 2.70
  assert.equal(result.totalCents, 4120)
  assert.deepEqual(result.lines.map((l) => l.lineTotalCents), [3000, 850])
})

test('the register’s tax-included prices come back to the cent', () => {
  // $257.10 with 7% tax is held by Lightspeed as $240.28037 before tax.
  const one = totals([line('240.28037')])
  assert.equal(one.subtotalCents, 24028)
  assert.equal(one.taxCents, 1682)
  assert.equal(one.totalCents, 25710)
  const three = totals([line('240.28037', 3)])
  assert.equal(three.subtotalCents, 72084)
  assert.equal(three.totalCents, 77130) // 3 x 257.10
})

test('a tax-exempt customer pays no tax, on goods or on delivery', () => {
  const result = totals([line('100.00', 3)], {
    taxExempt: true,
    delivery: 'ups',
    destinationZip: '90210',
    ups: { rateCents: 1850 },
    settings: { ...SETTINGS, deliveryTaxable: true },
  })
  assert.equal(result.taxCents, 0)
  assert.equal(result.taxableCents, 0)
  assert.equal(result.deliveryTaxCents, 0)
  assert.deepEqual(result.lines.map((l) => l.taxCents), [0])
  assert.equal(result.totalCents, 30000 + 1850)
})

test('lines that are not taxable are left out of the tax', () => {
  const result = totals([line('50.00'), line('30.00', 1, { taxable: false })])
  assert.equal(result.subtotalCents, 8000)
  assert.equal(result.taxableCents, 5000)
  assert.equal(result.taxCents, 350)
  assert.deepEqual(result.lines.map((l) => l.taxCents), [350, 0])
})

test('local delivery: offered at $200 and over to a ZIP on the list', () => {
  const under = totals([line('199.99')], { destinationZip: '33312' })
  assert.equal(option(under, 'local').available, false)
  assert.match(option(under, 'local').reason, /\$200\.00 or more\. Add \$0\.01 more/)

  const exactly = totals([line('200.00')], { destinationZip: '33312' })
  assert.deepEqual(option(exactly, 'local'), { method: 'local', label: 'Local delivery', available: true, reason: null, chargeCents: 0 })

  const offList = totals([line('500.00')], { destinationZip: '90210' })
  assert.equal(option(offList, 'local').available, false)
  assert.match(option(offList, 'local').reason, /ZIP code 90210/)

  const noZip = totals([line('500.00')])
  assert.equal(option(noZip, 'local').available, false)
  assert.match(option(noZip, 'local').reason, /Enter your delivery ZIP/)
})

test('the $200 minimum is judged on the subtotal before tax', () => {
  // 190 + 7% tax is over $200, but the goods are not.
  const result = totals([line('190.00')], { destinationZip: '33312' })
  assert.equal(result.totalCents > 20000, true)
  assert.equal(option(result, 'local').available, false)
})

test('ZIP codes match with or without the +4 part, on either side', () => {
  assert.equal(normalizeZip(' 33312-1234 '), '33312')
  assert.equal(normalizeZip('333121234'), '33312')
  assert.equal(normalizeZip('3331'), null)
  assert.equal(normalizeZip('abcde'), null)
  assert.equal(normalizeZip(null), null)
  assert.equal(option(totals([line('250.00')], { destinationZip: '33312-9999' }), 'local').available, true)
  assert.equal(option(totals([line('250.00')], { destinationZip: '33004' }), 'local').available, true)
})

test('with no ZIP list yet, local delivery is simply not offered', () => {
  const result = totals([line('900.00')], { destinationZip: '33312', settings: { ...SETTINGS, localZips: [] } })
  assert.equal(option(result, 'local').available, false)
  assert.match(option(result, 'local').reason, /not available/)
})

test('choosing a delivery that is not available is refused with the reason', () => {
  const result = totals([line('50.00')], { delivery: 'local', destinationZip: '33312' })
  assert.equal(result.ok, false)
  assert.match(result.error, /\$200\.00 or more/)
})

test('a local delivery fee is charged, and taxed only when the store taxes delivery', () => {
  const fee = { ...SETTINGS, localDeliveryFeeCents: 1500 }
  const untaxed = totals([line('300.00')], { delivery: 'local', destinationZip: '33314', settings: fee })
  assert.equal(untaxed.deliveryCents, 1500)
  assert.equal(untaxed.taxCents, 2100)
  assert.equal(untaxed.deliveryTaxCents, 0)
  assert.equal(untaxed.totalCents, 30000 + 1500 + 2100)

  const taxed = totals([line('300.00')], { delivery: 'local', destinationZip: '33314', settings: { ...fee, deliveryTaxable: true } })
  assert.equal(taxed.taxableCents, 31500)
  assert.equal(taxed.taxCents, 2205)
  assert.equal(taxed.deliveryTaxCents, 105)
  assert.deepEqual(taxed.lines.map((l) => l.taxCents), [2100])
  assert.equal(taxed.totalCents, 30000 + 1500 + 2205)
})

test('UPS: anyone with a ZIP can choose it, at the quoted rate', () => {
  const small = totals([line('12.00')], { delivery: 'ups', destinationZip: '33312', ups: { rateCents: 1423 } })
  assert.equal(small.ok, true)
  assert.equal(small.deliveryCents, 1423)
  assert.equal(small.totalCents, 1200 + 1423 + 84)
  assert.equal(option(small, 'ups').chargeCents, 1423)

  // Before a rate has come back it is offered, without a price, and can't be paid for yet.
  const waiting = totals([line('12.00')], { delivery: null, destinationZip: '33312' })
  assert.deepEqual(option(waiting, 'ups'), { method: 'ups', label: 'UPS shipping', available: true, reason: null, chargeCents: null })
  assert.equal(totals([line('12.00')], { delivery: 'ups', destinationZip: '33312' }).ok, false)

  const failed = totals([line('12.00')], { destinationZip: '33312', ups: { unavailable: 'UPS could not price this address.' } })
  assert.equal(option(failed, 'ups').reason, 'UPS could not price this address.')

  const noZip = totals([line('12.00')])
  assert.match(option(noZip, 'ups').reason, /ZIP code/)
})

test('UPS is not offered when an item has no shipping weight', () => {
  const result = totals([line('12.00'), line('8.00', 1, { weightLb: null })], { destinationZip: '33312', ups: { rateCents: 900 } })
  assert.equal(result.totalWeightLb, null)
  assert.equal(option(result, 'ups').available, false)
  assert.equal(option(result, 'pickup').available, true)
})

test('total weight is each line’s weight times its quantity', () => {
  const result = totals([line('1.00', 3, { weightLb: 2.5 }), line('1.00', 2, { weightLb: 0.125 })])
  assert.equal(result.totalWeightLb, 7.75)
})

test('before a delivery choice is made, the totals show the goods and tax only', () => {
  const result = totals([line('20.00')], { delivery: null })
  assert.equal(result.ok, true)
  assert.equal(result.delivery, null)
  assert.equal(result.deliveryCents, 0)
  assert.equal(result.totalCents, 2140)
  assert.deepEqual(result.options.map((o) => o.method), ['pickup', 'local', 'ups'])
})

test('lines with no price, a negative price or no quantity are refused', () => {
  for (const bad of [line('0'), line('0.00000'), line(0), line('-5.00'), line('free'), line(''), line(NaN), line('1.123456'), line('5.00', 0), line('5.00', -1), line('5.00', 1.5), line('5.00', 10001)]) {
    const result = totals([line('5.00'), bad])
    assert.equal(result.ok, false, JSON.stringify(bad))
    assert.match(result.error, /^Item 2/)
  }
  assert.equal(totals([]).ok, false)
})

test('settings that make no sense stop the order rather than guess', () => {
  assert.equal(totals([line('5.00')], { settings: { ...SETTINGS, taxRatePercent: 'seven' } }).ok, false)
  assert.equal(totals([line('5.00')], { settings: { ...SETTINGS, taxRatePercent: -1 } }).ok, false)
  assert.equal(totals([line('5.00')], { settings: { ...SETTINGS, taxRatePercent: 101 } }).ok, false)
  assert.equal(totals([line('5.00')], { settings: { ...SETTINGS, localDeliveryFeeCents: 2.5 } }).ok, false)
  assert.equal(totals([line('5.00')], { delivery: 'ups', destinationZip: '33312', ups: { rateCents: 12.3 } }).ok, false)
  assert.equal(totals([line('5.00')], { delivery: 'drone' }).ok, false)
})

test('rounding: half a cent rounds up, on line totals and on tax', () => {
  // 0.125 x 1 = 12.5 cents -> 13; 0.124 x 1 -> 12; 0.00500 -> 1 cent; 0.00499 -> 0 cents.
  assert.equal(totals([line('0.125')]).subtotalCents, 13)
  assert.equal(totals([line('0.124')]).subtotalCents, 12)
  assert.equal(totals([line('0.005')]).subtotalCents, 1)
  assert.equal(totals([line('0.00499', 2)]).subtotalCents, 1) // 0.998 cents
  // Tax of exactly half a cent: $0.50 x 7% = 3.5 cents -> 4.
  assert.equal(totals([line('0.50')]).taxCents, 4)
  // Just under: $0.49 x 7% = 3.43 -> 3.
  assert.equal(totals([line('0.49')]).taxCents, 3)
  // Amounts that floating-point arithmetic gets wrong: 1.005 x 100 is 100.49999… in binary.
  assert.equal(totals([line('1.005')]).subtotalCents, 101)
  assert.equal(totals([line(1.005)]).subtotalCents, 101)
  assert.equal(totals([line('0.07', 3)]).subtotalCents, 21)
})

test('rounding: tax is worked out on the whole order, not line by line', () => {
  // Three lines of $0.10 at 7%: each line alone is 0.7 cents (-> 1 each = 3), the order is 2.1 cents -> 2.
  const result = totals([line('0.10'), line('0.10'), line('0.10')])
  assert.equal(result.taxCents, 2)
  assert.deepEqual(result.lines.map((l) => l.taxCents), [1, 1, 0])
})

test('rounding: the line taxes always add up to the order’s tax', () => {
  const carts = [
    [line('19.99', 3), line('0.33', 7), line('240.28037', 2), line('5.00', 1, { taxable: false })],
    [line('0.01'), line('0.01'), line('0.01'), line('0.01'), line('0.01'), line('0.01'), line('0.01'), line('0.01')],
    [line('33.33'), line('33.33'), line('33.34')],
    [line('999999.99999', 10000)],
  ]
  for (const rate of [0, 6, 6.5, 7, 7.25, '8.875']) {
    for (const cart of carts) {
      const result = totals(cart, { delivery: 'local', destinationZip: '33312', settings: { ...SETTINGS, taxRatePercent: rate, localDeliveryMinimumCents: 0, localDeliveryFeeCents: 999, deliveryTaxable: true } })
      if (!result.ok) {
        assert.match(result.error, /too large/)
        continue
      }
      const lineTax = result.lines.reduce((sum, l) => sum + l.taxCents, 0)
      assert.equal(lineTax + result.deliveryTaxCents, result.taxCents)
      assert.equal(result.lines.reduce((sum, l) => sum + l.lineTotalCents, 0), result.subtotalCents)
      assert.equal(result.totalCents, result.subtotalCents + result.deliveryCents + result.taxCents)
      for (const value of [result.subtotalCents, result.taxCents, result.totalCents, ...result.lines.map((l) => l.taxCents)]) assert.equal(Number.isSafeInteger(value), true)
    }
  }
})

test('a tax rate of zero charges no tax', () => {
  const result = totals([line('80.00')], { settings: { ...SETTINGS, taxRatePercent: 0 } })
  assert.equal(result.taxCents, 0)
  assert.equal(result.totalCents, 8000)
})

test('delivery choices can be asked for on their own', () => {
  const options = deliveryOptions({ subtotalCents: 25000, destinationZip: '33314', ups: { rateCents: 2200 }, allLinesHaveWeight: true, settings: SETTINGS })
  assert.deepEqual(options.map((o) => [o.method, o.available, o.chargeCents]), [['pickup', true, 0], ['local', true, 0], ['ups', true, 2200]])
})

test('amounts are written the way a customer reads them', () => {
  assert.equal(formatCents(0), '$0.00')
  assert.equal(formatCents(5), '$0.05')
  assert.equal(formatCents(123456789), '$1,234,567.89')
})
