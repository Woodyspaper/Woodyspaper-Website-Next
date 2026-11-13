import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shownPrice } from '../src/services/priceDisplay.ts'

const price = (extra = {}) => ({
  listPrice: 41.27, listPriceFormatted: '$41.27', price: 41.27, priceFormatted: '$41.27', source: 'list', inStock: true, quantity: 5, ...extra,
})
const AS_BEFORE = { price: '$41.27', was: '', yours: false }

test('guests see exactly what the page showed before', () => {
  assert.deepEqual(shownPrice('$41.27', undefined), AS_BEFORE)
  assert.deepEqual(shownPrice('$41.27', null), AS_BEFORE)
  assert.deepEqual(shownPrice('', undefined), { price: '', was: '', yours: false })
})

test('a customer whose price is the list price sees no change', () => {
  assert.deepEqual(shownPrice('$41.27', price()), AS_BEFORE)
  // A price list that happens to hold the list price itself.
  assert.deepEqual(shownPrice('$41.27', price({ source: 'priceList' })), AS_BEFORE)
})

test('a lower price is shown as "Your price" with the list price struck through', () => {
  assert.deepEqual(shownPrice('$41.27', price({ price: 29.71, priceFormatted: '$29.71', source: 'groupDiscount' })), {
    price: '$29.71', was: '$41.27', yours: true,
  })
})

test('an agreed price above list is shown as theirs, with nothing struck through', () => {
  assert.deepEqual(shownPrice('$41.27', price({ price: 45, priceFormatted: '$45.00', source: 'priceList' })), {
    price: '$45.00', was: '', yours: true,
  })
})

test('a product our price table does not sell keeps what the page had', () => {
  const notSold = price({ listPrice: null, listPriceFormatted: '', price: null, priceFormatted: '', source: null })
  assert.deepEqual(shownPrice('$41.27', notSold), AS_BEFORE)
  assert.deepEqual(shownPrice('', notSold), { price: '', was: '', yours: false })
})
