import 'server-only'
import { query, sql } from '../db'
import { formatCents, priceListLineFor, resolvePrice, usablePriceList } from './resolvePrice'
import type { PriceListInfo, PriceListLine, PriceSource, PricingCustomer, PricingOptions } from './resolvePrice'

/*
 * Reads from our database what the price rules (resolvePrice.ts) need, and
 * works out the prices one visitor sees for the products on their screen.
 *
 * Whose prices: the customer (dbo.Customers) that the signed-in website
 * account has been matched to. That comes from the sign-in session and from
 * nowhere else, so one customer can never ask for another's prices. Guests
 * and accounts with no matched customer get list prices.
 *
 * Products are found by their Lightspeed eCom ids, because that is what the
 * pages hold today: Products.EcwidProductId and, for each version of a
 * product, ProductVariants.EcwidCombinationId. Never by SKU, which differs
 * between the two Lightspeed systems.
 */

/**
 * Price books Lightspeed marks "In Store" apply on the website too. That is
 * the owner's decision (November 2026): nearly every customer price book
 * carries that mark, and those customers are to see and pay their own prices
 * online. Setting APPLY_IN_STORE_PRICE_BOOKS=false in .env.local keeps such
 * books to the shop counter again.
 */
export function pricingOptions(): PricingOptions {
  return { applyInStoreLists: process.env.APPLY_IN_STORE_PRICE_BOOKS !== 'false' }
}

/** Lightspeed's label for a price book that is for the shop counter only (the same test the importer uses). */
const inStoreOnly = (platform: string | null) => /^\s*in[\s-]*store\s*$/i.test(platform ?? '')

/** The customer a website account is matched to, with what pricing needs. */
export type MatchedCustomer = {
  id: number
  companyName: string | null
  name: string | null
  /** The customer group that sets their pricing; null when they are in none. */
  groupId: number | null
  groupName: string | null
  taxExempt: boolean
  pricing: PricingCustomer
}

type CustomerRow = {
  Id: number
  CompanyName: string | null
  Name: string | null
  TaxExempt: boolean
  GroupId: number | null
  GroupName: string | null
  DiscountPercent: number | null
  OwnListId: number | null
  OwnListActive: boolean | null
  OwnListPlatform: string | null
  GroupListId: number | null
  GroupListActive: boolean | null
  GroupListPlatform: string | null
}

const CUSTOMER_SELECT = `
  SELECT c.Id, c.CompanyName, c.Name, c.TaxExempt, g.Id AS GroupId, g.Name AS GroupName, g.DiscountPercent,
         ol.Id AS OwnListId, ol.IsActive AS OwnListActive, ol.LightspeedPlatform AS OwnListPlatform,
         gl.Id AS GroupListId, gl.IsActive AS GroupListActive, gl.LightspeedPlatform AS GroupListPlatform
  FROM dbo.Customers c
  LEFT JOIN dbo.CustomerGroups g ON g.Id = c.CustomerGroupId
  LEFT JOIN dbo.PriceLists ol ON ol.Id = c.PriceListId
  LEFT JOIN dbo.PriceLists gl ON gl.Id = g.PriceListId`

const listInfo = (id: number | null, active: boolean | null, platform: string | null): PriceListInfo | null =>
  id == null ? null : { id, isActive: active === true, inStoreOnly: inStoreOnly(platform) }

async function toMatchedCustomer(row: CustomerRow | undefined): Promise<MatchedCustomer | null> {
  if (!row) return null
  const discountPercent = Number(row.DiscountPercent ?? 0)
  let excludedCategoryIds: number[] = []
  if (row.GroupId != null && discountPercent > 0) {
    const excluded = await (await query())
      .input('groupId', sql.Int, row.GroupId)
      .query<{ CategoryId: number }>('SELECT CategoryId FROM dbo.GroupDiscountExclusions WHERE CustomerGroupId = @groupId')
    excludedCategoryIds = excluded.recordset.map((entry) => entry.CategoryId)
  }
  return {
    id: row.Id,
    companyName: row.CompanyName,
    name: row.Name,
    groupId: row.GroupId,
    groupName: row.GroupName,
    taxExempt: row.TaxExempt === true,
    pricing: {
      ownPriceList: listInfo(row.OwnListId, row.OwnListActive, row.OwnListPlatform),
      groupPriceList: listInfo(row.GroupListId, row.GroupListActive, row.GroupListPlatform),
      discountPercent,
      excludedCategoryIds,
    },
  }
}

/** The active customer this website account has been matched to, or null. */
export async function customerForUser(userId: number): Promise<MatchedCustomer | null> {
  const found = await (await query())
    .input('userId', sql.Int, userId)
    .query<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.UserId = @userId AND c.IsActive = 1`)
  return toMatchedCustomer(found.recordset[0])
}

/** One customer by their id in our database. For staff tools and checks; never called with an id a visitor sent. */
export async function customerById(customerId: number): Promise<MatchedCustomer | null> {
  const found = await (await query())
    .input('customerId', sql.Int, customerId)
    .query<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.Id = @customerId`)
  return toMatchedCustomer(found.recordset[0])
}

/** A price as the pages use it. */
export type VisitorPrice = {
  /** List price in dollars and as text ("$41.27"); null and '' when the variant has no price and is not sold. */
  listPrice: number | null
  listPriceFormatted: string
  /** What this visitor pays for one unit. Equal to the list price for guests. */
  price: number | null
  priceFormatted: string
  /** Where the visitor's price came from; null when the variant is not sold. */
  source: PriceSource | null
  /** There is some to sell (or the store doesn't count this one). */
  inStock: boolean
  /** Units that can be sold now; null when the store doesn't count this one. */
  quantity: number | null
  /** Quantity breaks on the customer's price list, lowest quantity first. Only present when there are any. */
  breaks?: { minQty: number; maxQty: number | null; price: number; priceFormatted: string }[]
}

export type ProductPrices = VisitorPrice & {
  /** Lightspeed eCom product id, as sent. */
  id: number
  /** One entry per version of the product that eCom knows as a combination. */
  variations: (VisitorPrice & { id: number })[]
}

/** The most products one request may ask about: two pages of the product list, with room to spare. */
export const MAX_PRODUCTS_PER_REQUEST = 60

type VariantRow = {
  EcwidProductId: string | number
  ProductId: number
  ProductEnabled: boolean
  VariantId: number
  EcwidCombinationId: string | number | null
  Price: number
  IsDefault: boolean
  IsEnabled: boolean
  QtyOnHand: number | null
  QtyReserved: number | null
  TrackStock: boolean | null
  AllowBackorder: boolean | null
}

/** Whether db/007_price_breaks.sql has been run (quantity-break columns exist). Asked once, then remembered. */
let breakColumns: Promise<boolean> | undefined
function hasBreakColumns(): Promise<boolean> {
  breakColumns ??= query()
    .then((request) => request.query<{ L: number | null }>("SELECT COL_LENGTH('dbo.PriceListItems', 'MinQty') AS L"))
    .then((result) => result.recordset[0].L != null)
  // A failed check isn't kept: the next request asks again.
  breakColumns.catch(() => { breakColumns = undefined })
  return breakColumns
}

const dollars = (cents: number) => cents / 100

/**
 * Prices and stock for the given Lightspeed eCom product ids, as `customer`
 * sees them (null = a guest: list prices). Products we don't have are simply
 * left out of the answer. `ecwidProductIds` must already be checked: whole
 * positive numbers, at most MAX_PRODUCTS_PER_REQUEST of them.
 */
export async function pricesForProducts(ecwidProductIds: number[], customer: MatchedCustomer | null): Promise<ProductPrices[]> {
  if (ecwidProductIds.length === 0) return []
  // Every id is passed as its own parameter (@p0, @p1, …), never written into the SQL text.
  const withIds = (request: sql.Request) => {
    ecwidProductIds.forEach((id, index) => request.input(`p${index}`, sql.BigInt, id))
    return request
  }
  const idList = ecwidProductIds.map((_, index) => `@p${index}`).join(', ')
  const variantsOnScreen = `SELECT v.Id FROM dbo.ProductVariants v JOIN dbo.Products p ON p.Id = v.ProductId WHERE p.EcwidProductId IN (${idList})`

  const variants = (
    await withIds(await query()).query<VariantRow>(
      `SELECT p.EcwidProductId, p.Id AS ProductId, p.IsEnabled AS ProductEnabled, v.Id AS VariantId, v.EcwidCombinationId, v.Price,
              v.IsDefault, v.IsEnabled, i.QtyOnHand, i.QtyReserved, i.TrackStock, i.AllowBackorder
       FROM dbo.Products p
       JOIN dbo.ProductVariants v ON v.ProductId = p.Id
       LEFT JOIN dbo.Inventory i ON i.VariantId = v.Id
       WHERE p.EcwidProductId IN (${idList})
       ORDER BY p.Id, v.SortOrder, v.Id`,
    )
  ).recordset
  if (variants.length === 0) return []

  // What only a matched customer has: agreed prices, their price list's lines, and the categories their discount leaves out.
  const agreed = new Map<number, number>()
  const listLines = new Map<number, PriceListLine[]>()
  const categories = new Map<number, number[]>()
  if (customer) {
    const priceList = usablePriceList(customer.pricing, pricingOptions())
    const needCategories = customer.pricing.discountPercent > 0 && customer.pricing.excludedCategoryIds.length > 0
    const [agreedRows, lineRows, categoryRows, treeRows] = await Promise.all([
      withIds(await query())
        .input('customerId', sql.Int, customer.id)
        .query<{ VariantId: number; Price: number }>(
          `SELECT VariantId, Price FROM dbo.CustomerPrices WHERE CustomerId = @customerId AND VariantId IN (${variantsOnScreen})`,
        ),
      priceList
        ? withIds(await query())
            .input('priceListId', sql.Int, priceList.id)
            .query<{ VariantId: number; Price: number; MinQty: number; MaxQty: number | null }>(
              `SELECT VariantId, Price, ${(await hasBreakColumns()) ? 'MinQty, MaxQty' : '1 AS MinQty, CAST(NULL AS INT) AS MaxQty'}
               FROM dbo.PriceListItems WHERE PriceListId = @priceListId AND VariantId IN (${variantsOnScreen})`,
            )
        : null,
      needCategories
        ? withIds(await query()).query<{ ProductId: number; CategoryId: number }>(
            `SELECT pc.ProductId, pc.CategoryId FROM dbo.ProductCategories pc JOIN dbo.Products p ON p.Id = pc.ProductId WHERE p.EcwidProductId IN (${idList})
             UNION
             SELECT p.Id, p.DefaultCategoryId FROM dbo.Products p WHERE p.EcwidProductId IN (${idList}) AND p.DefaultCategoryId IS NOT NULL`,
          )
        : null,
      needCategories ? (await query()).query<{ Id: number; ParentId: number | null }>('SELECT Id, ParentId FROM dbo.Categories') : null,
    ])
    for (const row of agreedRows.recordset) agreed.set(row.VariantId, Number(row.Price))
    for (const row of lineRows?.recordset ?? []) {
      const lines = listLines.get(row.VariantId) ?? []
      lines.push({ minQty: row.MinQty, maxQty: row.MaxQty, price: Number(row.Price) })
      listLines.set(row.VariantId, lines)
    }
    // A product in "Paper / Bond" is also in "Paper": a discount that leaves out a
    // category leaves out everything beneath it, so each category brings its parents along.
    const parentOf = new Map((treeRows?.recordset ?? []).map((row) => [row.Id, row.ParentId]))
    for (const row of categoryRows?.recordset ?? []) {
      const list = categories.get(row.ProductId) ?? []
      // The step limit only guards against a loop in the category tree.
      for (let id: number | null | undefined = row.CategoryId, steps = 0; id != null && steps < 20; id = parentOf.get(id), steps++) {
        if (!list.includes(id)) list.push(id)
      }
      categories.set(row.ProductId, list)
    }
  }

  const priceOf = (row: VariantRow): VisitorPrice => {
    const lines = listLines.get(row.VariantId)
    const variant = {
      listPrice: Number(row.Price),
      categoryIds: categories.get(row.ProductId) ?? [],
      customerPrice: agreed.get(row.VariantId) ?? null,
      priceListLines: lines,
    }
    const resolved = resolvePrice(customer?.pricing ?? null, variant, 1)
    const counted = row.TrackStock !== false
    const available = (row.QtyOnHand ?? 0) - (row.QtyReserved ?? 0)
    const stock = {
      inStock: row.ProductEnabled && row.IsEnabled && resolved.sellable && (!counted || row.AllowBackorder === true || available > 0),
      quantity: counted ? Math.max(0, available) : null,
    }
    if (!resolved.sellable) return { listPrice: null, listPriceFormatted: '', price: null, priceFormatted: '', source: null, ...stock }

    const price: VisitorPrice = {
      listPrice: dollars(resolved.listCents),
      listPriceFormatted: formatCents(resolved.listCents),
      price: dollars(resolved.unitCents),
      priceFormatted: formatCents(resolved.unitCents),
      source: resolved.source,
      ...stock,
    }
    // Quantity breaks are shown only when the price list is what sets this customer's price for the variant.
    const hasBreaks = (lines ?? []).some((line) => line.minQty > 1 || line.maxQty != null)
    if (hasBreaks && !variant.customerPrice) {
      price.breaks = [...(lines ?? [])]
        .sort((a, b) => a.minQty - b.minQty)
        // Each break as the rules would price it at its first quantity.
        .filter((line) => priceListLineFor(lines, line.minQty) === line)
        .map((line) => {
          const at = resolvePrice(customer?.pricing ?? null, variant, line.minQty)
          return { minQty: line.minQty, maxQty: line.maxQty, price: dollars(at.unitCents ?? 0), priceFormatted: formatCents(at.unitCents ?? 0) }
        })
    }
    return price
  }

  const products = new Map<number, { rows: VariantRow[] }>()
  for (const row of variants) {
    const id = Number(row.EcwidProductId)
    const entry = products.get(id) ?? { rows: [] }
    entry.rows.push(row)
    products.set(id, entry)
  }
  return [...products].map(([id, { rows }]) => {
    // The price on a product's card is that of its default version.
    const main = rows.find((row) => row.IsDefault) ?? rows[0]
    return {
      id,
      ...priceOf(main),
      variations: rows
        .filter((row) => row.EcwidCombinationId != null)
        .map((row) => ({ id: Number(row.EcwidCombinationId), ...priceOf(row) })),
    }
  })
}
