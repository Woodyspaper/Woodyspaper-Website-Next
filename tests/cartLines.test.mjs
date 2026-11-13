import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toCartLines } from '../src/services/cartLines.ts'

const money = (amount) => `$${amount.toFixed(2)}`

test('a store cart item becomes a line with its choices, unit price and line total', () => {
  const [line] = toCartLines(
    [
      {
        quantity: 3,
        options: { UOM: 'CASE', COLOR: '' },
        product: { id: 7, name: 'Hot cup 12 oz', sku: '1005290 - Base', price: 41.27 },
      },
    ],
    money,
  )
  assert.deepEqual(line, {
    id: 7,
    name: 'Hot cup 12 oz',
    sku: '1005290',
    options: { UOM: 'CASE' },
    quantity: 3,
    price: '$41.27',
    lineTotal: '$123.81',
    image: '',
  })
})

test('the thumbnail is the smallest photo that is still sharp enough', () => {
  const [line] = toCartLines(
    [
      {
        quantity: 1,
        product: {
          id: 1,
          mediaItem: {
            id: 42,
            isMain: true,
            image1500pxUrl: 'https://cdn.example/big.jpg',
            image160pxUrl: 'https://cdn.example/small.jpg',
            image400pxUrl: 'https://cdn.example/medium.jpg',
          },
        },
      },
    ],
    money,
  )
  assert.equal(line.image, 'https://cdn.example/small.jpg')
})

test('missing details never break the cart', () => {
  const [line] = toCartLines([{ quantity: 2, options: null, product: { id: 9, mediaItem: null } }], money)
  assert.deepEqual(line, { id: 9, name: 'Product', sku: '', options: {}, quantity: 2, price: '', lineTotal: '', image: '' })
  assert.deepEqual(toCartLines([], money), [])
})

test('only https picture addresses are used', () => {
  const [line] = toCartLines([{ quantity: 1, product: { id: 1, mediaItem: { imageUrl: 'javascript:alert(1)', alt: 'photo.jpg' } } }], money)
  assert.equal(line.image, '')
})
