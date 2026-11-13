import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCents, priceListLineFor, resolvePrice, toCents, usablePriceList } from '../src/server/pricing/resolvePrice.ts'

const list = (id, extra = {}) => ({ id, isActive: true, inStoreOnly: false, ...extra })
const customer = (extra = {}) => ({ ownPriceList: null, groupPriceList: null, discountPercent: 0, excludedCategoryIds: [], ...extra })
const variant = (extra = {}) => ({ listPrice: 10, categoryIds: [5], ...extra })
const WEBSITE = { applyInStoreLists: false }

test('guests and unmatched accounts pay the list price', () => {
  assert.deepEqual(resolvePrice(null, variant()), { sellable: true, unitCents: 1000, listCents: 1000, source: 'list' })
  // Whatever is on file for some customer never reaches a guest.
  assert.equal(resolvePrice(null, variant({ customerPrice: 1, priceListLines: [{ minQty: 1, maxQty: null, price: 2 }] })).unitCents, 1000)
})

test('a customer with nothing special pays the list price', () => {
  assert.deepEqual(resolvePrice(customer(), variant()), { sellable: true, unitCents: 1000, listCents: 1000, source: 'list' })
})

test('a variant with no list price is never sold', () => {
  const everything = { customerPrice: 4, priceListLines: [{ minQty: 1, maxQty: null, price: 5 }] }
  for (const listPrice of [null, 0, -3, Number.NaN, 0.004]) {
    assert.deepEqual(resolvePrice(customer({ discountPercent: 20 }), variant({ listPrice, ...everything })), {
      sellable: false, unitCents: null, listCents: null, source: null,
    })
  }
  assert.equal(resolvePrice(null, variant({ listPrice: 0 })).sellable, false)
})

test('a price agreed with the customer comes first', () => {
  const result = resolvePrice(
    customer({ groupPriceList: list(1), discountPercent: 30 }),
    variant({ customerPrice: 6.5, priceListLines: [{ minQty: 1, maxQty: null, price: 7 }] }),
  )
  assert.deepEqual(result, { sellable: true, unitCents: 650, listCents: 1000, source: 'customer' })
})

test('the price list comes before the group discount, even when it is the dearer of the two', () => {
  const result = resolvePrice(customer({ groupPriceList: list(1), discountPercent: 50 }), variant({ priceListLines: [{ minQty: 1, maxQty: null, price: 8.25 }] }))
  assert.deepEqual(result, { sellable: true, unitCents: 825, listCents: 1000, source: 'priceList' })
})

test('a variant the price list does not carry falls back to the group discount, then list', () => {
  assert.equal(resolvePrice(customer({ groupPriceList: list(1), discountPercent: 28 }), variant({ priceListLines: [] })).source, 'groupDiscount')
  assert.equal(resolvePrice(customer({ groupPriceList: list(1) }), variant()).source, 'list')
  // A zero line on a list is not a price.
  assert.equal(resolvePrice(customer({ groupPriceList: list(1) }), variant({ priceListLines: [{ minQty: 1, maxQty: null, price: 0 }] })).source, 'list')
})

test('group discount: percent off the list price', () => {
  assert.deepEqual(resolvePrice(customer({ discountPercent: 28 }), variant({ listPrice: 41.27 })), {
    sellable: true, unitCents: 2971, listCents: 4127, source: 'groupDiscount', // 41.27 × 0.72 = 29.7144
  })
  assert.equal(resolvePrice(customer({ discountPercent: 37.5 }), variant({ listPrice: 80 })).unitCents, 5000)
})

test('group discount: skipped for a product in an excluded category', () => {
  const tier = customer({ discountPercent: 28, excludedCategoryIds: [9, 12] })
  assert.equal(resolvePrice(tier, variant({ categoryIds: [5] })).source, 'groupDiscount')
  assert.deepEqual(resolvePrice(tier, variant({ categoryIds: [5, 12] })), { sellable: true, unitCents: 1000, listCents: 1000, source: 'list' })
  // The exclusion is about the percent only: a price list still applies.
  const withList = customer({ groupPriceList: list(1), discountPercent: 28, excludedCategoryIds: [12] })
  assert.equal(resolvePrice(withList, variant({ categoryIds: [12], priceListLines: [{ minQty: 1, maxQty: null, price: 6 }] })).source, 'priceList')
})

test('group discount: a percent that makes no sense is ignored', () => {
  for (const discountPercent of [0, -5, 100, 150, Number.NaN]) {
    assert.equal(resolvePrice(customer({ discountPercent }), variant()).source, 'list')
  }
})

test('quantity breaks: the line whose range holds the quantity', () => {
  const lines = [
    { minQty: 1, maxQty: 9, price: 9 },
    { minQty: 10, maxQty: 49, price: 8 },
    { minQty: 50, maxQty: null, price: 7.5 },
  ]
  const buyer = customer({ groupPriceList: list(1) })
  const priceAt = (quantity) => resolvePrice(buyer, variant({ priceListLines: lines }), quantity).unitCents
  assert.deepEqual([1, 9, 10, 49, 50, 5000].map(priceAt), [900, 900, 800, 800, 750, 750])
  // The quantity defaults to 1; nonsense counts as 1; part units round down.
  assert.equal(resolvePrice(buyer, variant({ priceListLines: lines })).unitCents, 900)
  assert.deepEqual([0, -2, Number.NaN, 10.9].map(priceAt), [900, 900, 900, 800])
})

test('quantity breaks: below the first break, or in a gap, the next rule down applies', () => {
  const lines = [{ minQty: 10, maxQty: 19, price: 8 }, { minQty: 30, maxQty: null, price: 7 }]
  const buyer = customer({ groupPriceList: list(1), discountPercent: 10 })
  assert.deepEqual(resolvePrice(buyer, variant({ priceListLines: lines }), 3), { sellable: true, unitCents: 900, listCents: 1000, source: 'groupDiscount' })
  assert.equal(resolvePrice(buyer, variant({ priceListLines: lines }), 25).source, 'groupDiscount')
  assert.equal(resolvePrice(buyer, variant({ priceListLines: lines }), 12).unitCents, 800)
  assert.equal(priceListLineFor(lines, 3), null)
  // Overlapping ranges: the one that starts highest wins.
  assert.equal(priceListLineFor([{ minQty: 1, maxQty: null, price: 9 }, { minQty: 10, maxQty: null, price: 8 }], 10).price, 8)
})

test('which price list: the customer\'s own first, else the group\'s', () => {
  const own = list(1)
  const group = list(2)
  assert.equal(usablePriceList(customer({ ownPriceList: own, groupPriceList: group }), WEBSITE), own)
  assert.equal(usablePriceList(customer({ groupPriceList: group }), WEBSITE), group)
  assert.equal(usablePriceList(customer(), WEBSITE), null)
  assert.equal(usablePriceList(null, WEBSITE), null)
})

test('which price list: one that is switched off is passed over', () => {
  const off = list(1, { isActive: false })
  const group = list(2)
  assert.equal(usablePriceList(customer({ ownPriceList: off, groupPriceList: group }), WEBSITE), group)
  assert.equal(usablePriceList(customer({ groupPriceList: off }), WEBSITE), null)
})

test('which price list: "In Store" lists stay off the website unless allowed', () => {
  const counter = list(1, { inStoreOnly: true })
  const everywhere = list(2)
  assert.equal(usablePriceList(customer({ groupPriceList: counter }), WEBSITE), null)
  assert.equal(usablePriceList(customer({ ownPriceList: counter, groupPriceList: everywhere }), WEBSITE), everywhere)
  assert.equal(usablePriceList(customer({ groupPriceList: counter }), { applyInStoreLists: true }), counter)
  // Allowed online, but switched off is still off.
  assert.equal(usablePriceList(customer({ groupPriceList: list(3, { inStoreOnly: true, isActive: false }) }), { applyInStoreLists: true }), null)
})

test('money: rounded once, to the cent, halves up', () => {
  assert.equal(toCents(7.125), 713)
  assert.equal(toCents(7.12499), 712)
  assert.equal(toCents(53.71028), 5371)
  assert.equal(toCents(0.005), 1)
  assert.equal(toCents(1.005), 101) // 1.005 can't be held exactly as a fraction; the whole-number sums get it right
  assert.equal(toCents(269.9), 26990)
  assert.equal(toCents(0), null)
  assert.equal(toCents(null), null)
  // 28% off $10.005 is $7.2036 → $7.20; 50% off $0.01 is half a cent → 1 cent.
  assert.equal(resolvePrice(customer({ discountPercent: 28 }), variant({ listPrice: 10.005 })).unitCents, 720)
  assert.equal(resolvePrice(customer({ discountPercent: 50 }), variant({ listPrice: 0.01 })).unitCents, 1)
  // The discount is worked from the exact stored price, not the rounded one: 12.5% off 19.996 = 17.4965 → 17.50.
  assert.equal(resolvePrice(customer({ discountPercent: 12.5 }), variant({ listPrice: 19.996 })).unitCents, 1750)
  // Three decimals of percent are kept: 33.333% off $300 = $200.001 → $200.00.
  assert.equal(resolvePrice(customer({ discountPercent: 33.333 }), variant({ listPrice: 300 })).unitCents, 20000)
  // Large amounts stay exact.
  assert.equal(resolvePrice(customer({ discountPercent: 37.5 }), variant({ listPrice: 9_999_999.99999 })).unitCents, 625_000_000)
})

test('money: every cent amount matches exact arithmetic', () => {
  // Checked against sums done in whole numbers a different way (BigInt on the decimal digits).
  const exact = (price, percent) => {
    const units = BigInt(Math.round(price * 100000))
    const keep = BigInt(100000 - Math.round(percent * 1000))
    const total = units * keep // 1e-10 dollars
    const cent = 100000000n
    return Number(total / cent + (total % cent >= cent / 2n ? 1n : 0n))
  }
  for (const price of [0.01, 0.99, 3.33333, 12.345, 41.27, 99.995, 269.9, 1234.56789]) {
    for (const percent of [5, 12.5, 28, 32, 33, 35, 37, 37.5, 38, 39, 44, 99.999]) {
      const result = resolvePrice(customer({ discountPercent: percent }), variant({ listPrice: price }))
      const expected = exact(price, percent)
      if (expected > 0) assert.equal(result.unitCents, expected, `${percent}% off ${price}`)
      else assert.equal(result.source, 'list')
    }
  }
})

test('formatting cents', () => {
  assert.equal(formatCents(5), '$0.05')
  assert.equal(formatCents(4127), '$41.27')
  assert.equal(formatCents(123456), '$1,234.56')
  assert.equal(formatCents(100000000), '$1,000,000.00')
})
