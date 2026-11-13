import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_QUERY,
  PAGE_SIZE,
  facetParams,
  legacyHref,
  listHref,
  pageParams,
  parseListQuery,
  productHref,
} from '../src/services/storeRoutes.ts'

const parse = (search) => parseListQuery(new URLSearchParams(search))

test('a plain address is the default view', () => {
  assert.deepEqual(parse(''), EMPTY_QUERY)
  assert.equal(listHref(EMPTY_QUERY), '/inventory')
  assert.equal(listHref(), '/inventory')
})

test('search, category, filters, stock, sort and page survive a round trip through the address', () => {
  const query = {
    q: 'hot cups',
    category: 206814148,
    filters: { attribute_Brand: ['DIXIE', 'SOLO'], option_COLOR: ['WHITE'] },
    inStock: true,
    sort: 'price-low',
    page: 3,
  }
  const href = listHref(query)
  assert.equal(href, '/inventory?q=hot+cups&category=206814148&brand=DIXIE,SOLO&color=WHITE&stock=1&sort=price-low&page=3')
  assert.deepEqual(parse(href.split('?')[1]), query)
})

test('values needing escapes come back intact', () => {
  const query = { ...EMPTY_QUERY, q: '8.5 x 11 & 20#', filters: { attribute_Brand: ['M&M / MARS'] } }
  assert.deepEqual(parse(listHref(query).split('?')[1]), query)
})

test('nonsense in the address falls back to defaults instead of breaking the page', () => {
  const query = parse('category=abc&page=-2&sort=drop%20table&stock=yes&brand=,,&q=' + 'x'.repeat(500))
  assert.equal(query.category, null)
  assert.equal(query.page, 1)
  assert.equal(query.sort, 'relevance')
  assert.equal(query.inStock, false)
  assert.deepEqual(query.filters, {})
  assert.equal(query.q.length, 100)
})

test('the product search is asked for exactly the view on show', () => {
  const query = { ...EMPTY_QUERY, q: 'cups', category: 5, filters: { attribute_Brand: ['DIXIE', 'SOLO'] }, inStock: true, sort: 'price-high', page: 2 }
  assert.deepEqual(pageParams(query), {
    enabled: 'true',
    keyword: 'cups',
    categories: '5',
    includeProductsFromSubcategories: 'true',
    attribute_Brand: 'DIXIE,SOLO',
    inStock: 'true',
    sortBy: 'PRICE_DESC',
    limit: String(PAGE_SIZE),
    offset: String(PAGE_SIZE),
  })
  // Hidden products are never listed, even in the plainest view.
  assert.deepEqual(pageParams(EMPTY_QUERY), { enabled: 'true', limit: String(PAGE_SIZE), offset: '0' })
})

test('the filter-values call gets the same view, with stock named its way', () => {
  const query = { ...EMPTY_QUERY, q: 'cups', category: 5, filters: { option_COLOR: ['WHITE'] }, inStock: true }
  assert.deepEqual(facetParams(query), { keyword: 'cups', categories: '5', option_COLOR: 'WHITE', inventory: 'instock' })
  assert.deepEqual(facetParams(EMPTY_QUERY), {})
})

test('links made for the old embedded store go to the page that shows the same thing now', () => {
  assert.equal(legacyHref('#!/napkin-lunch-white/p/866396123'), productHref(866396123))
  assert.equal(legacyHref('#!/food-handling/c/206814148'), '/inventory?category=206814148')
  assert.equal(
    legacyHref('#!/~/search/keyword=cups*&attribute_Brand=DIXIE&inventory=instock'),
    '/inventory?q=cups&brand=DIXIE&stock=1',
  )
  assert.equal(legacyHref('#!/~/cart'), '/checkout')
  assert.equal(legacyHref('#!/~/account'), '/checkout?account=1')
  assert.equal(legacyHref('#!/'), '/inventory')
})

test('an ordinary hash, or none, is left alone', () => {
  assert.equal(legacyHref(''), null)
  assert.equal(legacyHref('#products'), null)
  assert.equal(legacyHref('#contact'), null)
})
