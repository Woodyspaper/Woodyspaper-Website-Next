// Copies the catalog, customers and pricing out of Lightspeed into the
// store's own tables in WOODYS_IND (db/004_catalog.sql, db/005_customers_pricing.sql).
//
//   node scripts/import-lightspeed.mjs --dry-run          show what would change, write nothing
//   node scripts/import-lightspeed.mjs                    import everything
//   node scripts/import-lightspeed.mjs --images           …and download product and category photos
//   node scripts/import-lightspeed.mjs --only=catalog     one part: catalog, customers or pricing (comma-separated)
//   node scripts/import-lightspeed.mjs --from-dump        read the JSON saved by the discovery scripts instead of calling Lightspeed
//   node scripts/import-lightspeed.mjs --disable-missing  switch off products and customers Lightspeed no longer has
//
// Lightspeed is only read (GET). Safe to run again: rows are matched on their
// Lightspeed id, and a second run with nothing new changes nothing.
//
// Until the site stops using Lightspeed, Lightspeed is the source of truth:
// each run overwrites the imported fields. What an import never touches:
// a customer's website account link, tax-exempt flag and own price list,
// dbo.CustomerPrices, hidden categories, addresses added on the website, and
// any row that did not come from Lightspeed. Nothing is deleted except link
// rows that follow their parent (options, product categories, photos, price
// list lines, Lightspeed addresses).
//
// Everything is written in one transaction; --dry-run rolls it back.
// Photos go to MEDIA_DIR (default %LOCALAPPDATA%\WoodysPaper\media), named by
// their content hash. It must stay outside the repo.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sql from 'mssql'
import { buildCatalog, buildCustomers, buildPricing } from '../src/server/import/lightspeedMap.ts'
import { ecomAll, retailAll } from './lib/lightspeed.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const envFile = path.join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const dryRun = flag('dry-run')
const fromDump = flag('from-dump')
const withImages = flag('images')
const disableMissing = flag('disable-missing')
const PARTS = ['catalog', 'customers', 'pricing']
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? PARTS
const unknown = [...only.filter((p) => !PARTS.includes(p)), ...args.filter((a) => !/^--(dry-run|from-dump|images|disable-missing|only=.+)$/.test(a))]
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(', ')}`)
  process.exit(1)
}

const dataDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'WoodysPaper')
const dumpDir = process.env.LIGHTSPEED_DUMP_DIR || path.join(dataDir, 'lightspeed-dump')
const mediaDir = process.env.MEDIA_DIR || path.join(dataDir, 'media')
if (path.resolve(mediaDir).startsWith(path.resolve(root))) {
  console.error('MEDIA_DIR must be outside the repo.')
  process.exit(1)
}

/** eCom category ids kept but not listed on the site (set only when the category is first imported). */
const HIDDEN_CATEGORY_IDS = [206814161] // "FOOD HANDLIING", a misspelt duplicate of Food Handling

// ---- Reading Lightspeed ------------------------------------------------------
const fromFile = async (name) => JSON.parse(await readFile(path.join(dumpDir, `${name}.json`), 'utf8'))
const retail = (resource) => (fromDump ? fromFile(`retail/${resource}`) : retailAll(resource))
const ecom = (resource) => (fromDump ? fromFile(resource) : ecomAll(resource))

// ---- Writing to SQL Server ---------------------------------------------------
function sqlType(declaration) {
  const [, name, a, b] = /^(\w+)(?:\((\w+)(?:,\s*(\d+))?\))?$/.exec(declaration)
  switch (name) {
    case 'NVARCHAR': return a === 'MAX' ? sql.NVarChar(sql.MAX) : sql.NVarChar(Number(a))
    case 'VARCHAR': return sql.VarChar(Number(a))
    case 'CHAR': return sql.Char(Number(a))
    case 'INT': return sql.Int
    case 'BIGINT': return sql.BigInt
    case 'BIT': return sql.Bit
    case 'DECIMAL': return sql.Decimal(Number(a), Number(b))
    case 'DATETIME2': return sql.DateTime2(Number(a))
    default: throw new Error(`Unhandled column type ${declaration}`)
  }
}

const round = (value, places) => (value == null ? null : Math.round(value * 10 ** places) / 10 ** places)

/**
 * Loads rows into a temporary table #S and merges them into a target table.
 *   stage      [name, type] per column of #S, in the order of each row's values
 *   source     SELECT over #S (alias s) whose columns are named like the target's
 *   key        target columns a row is matched on
 *   update     columns kept in step with Lightspeed
 *   insertOnly columns set when the row is first created and left alone after
 *   set        extra SET text for updates
 *   touch      also set UpdatedAt when a row changes
 *   deleteWhen condition on target rows (alias t) that may be deleted when Lightspeed no longer has them
 *   missing    { where, flag } — target rows (alias t) Lightspeed no longer has: counted, switched off with --disable-missing
 *   after      SQL run while #S still exists; its changed rows count as updates
 */
async function merge(tx, counts, spec) {
  const columns = spec.stage.map(([name, type]) => `${name} ${type}${/CHAR/.test(type) ? ' COLLATE DATABASE_DEFAULT' : ''} NULL`)
  await new sql.Request(tx).batch(`CREATE TABLE #S (${columns.join(', ')})`)
  try {
    const table = new sql.Table('#S')
    table.create = false
    for (const [name, type] of spec.stage) table.columns.add(name, sqlType(type), { nullable: true })
    for (const row of spec.rows) table.rows.add(...row)
    if (spec.rows.length) await new sql.Request(tx).bulk(table)

    const update = spec.update ?? []
    const all = [...spec.key, ...update, ...(spec.insertOnly ?? [])]
    const matched = update.length
      ? `WHEN MATCHED AND EXISTS (SELECT ${update.map((c) => `s.${c}`).join(', ')} EXCEPT SELECT ${update.map((c) => `t.${c}`).join(', ')})
           THEN UPDATE SET ${update.map((c) => `${c} = s.${c}`).join(', ')}${spec.touch ? ', UpdatedAt = SYSUTCDATETIME()' : ''}${spec.set ?? ''}`
      : ''
    const result = await new sql.Request(tx).batch(`
      DECLARE @r TABLE (Act NVARCHAR(10));
      MERGE dbo.${spec.target} AS t
      USING (${spec.source}) AS s ON ${spec.key.map((c) => `t.${c} = s.${c}`).join(' AND ')}
      ${matched}
      WHEN NOT MATCHED BY TARGET THEN INSERT (${all.join(', ')}) VALUES (${all.map((c) => `s.${c}`).join(', ')})
      ${spec.deleteWhen ? `WHEN NOT MATCHED BY SOURCE AND ${spec.deleteWhen} THEN DELETE` : ''}
      OUTPUT $action INTO @r;
      SELECT Act, COUNT(*) AS N FROM @r GROUP BY Act;`)
    const entry = { source: spec.rows.length, inserted: 0, updated: 0, deleted: 0 }
    for (const row of result.recordset ?? []) entry[{ INSERT: 'inserted', UPDATE: 'updated', DELETE: 'deleted' }[row.Act]] = row.N

    if (spec.after) entry.updated += (await new sql.Request(tx).batch(spec.after)).rowsAffected.reduce((a, b) => a + b, 0)
    if (spec.missing) {
      const absent = `FROM dbo.${spec.target} t WHERE ${spec.missing.where} AND NOT EXISTS (SELECT 1 FROM #S s WHERE s.RetailId = t.RetailId)`
      entry.missing = (await new sql.Request(tx).query(`SELECT COUNT(*) AS N ${absent}`)).recordset[0].N
      if (disableMissing && entry.missing) {
        entry.disabled = (await new sql.Request(tx).batch(`UPDATE t SET ${spec.missing.flag} = 0 ${absent} AND t.${spec.missing.flag} = 1`)).rowsAffected[0]
      }
    }
    // A table merged twice in one run (customer groups) reports the two together.
    const earlier = counts[spec.target]
    if (earlier) for (const name of ['inserted', 'updated', 'deleted']) entry[name] += earlier[name]
    counts[spec.target] = entry
    return entry
  } finally {
    await new sql.Request(tx).batch('DROP TABLE #S')
  }
}

const IMPORTED_PRODUCTS = '(SELECT Id FROM dbo.Products WHERE RetailId IS NOT NULL)'
const IMPORTED_VARIANTS = '(SELECT Id FROM dbo.ProductVariants WHERE RetailId IS NOT NULL)'

async function importCatalog(tx, counts, notes) {
  const [retailProducts, retailBrands, retailInventory, ecomProducts, ecomCategories] = await Promise.all([
    retail('products'), retail('brands'), retail('inventory'), ecom('products'), ecom('categories'),
  ])
  const c = buildCatalog({ retailProducts, retailBrands, retailInventory, ecomProducts, ecomCategories, hiddenCategoryIds: HIDDEN_CATEGORY_IDS })
  notes.push(`Catalog read: ${retailProducts.length} POS product rows, ${ecomProducts.length} eCom products → ${c.products.length} products, ${c.variants.length} variants`)

  await merge(tx, counts, {
    target: 'Brands',
    stage: [['RetailId', 'VARCHAR(40)'], ['Name', 'NVARCHAR(100)'], ['Slug', 'NVARCHAR(120)']],
    rows: c.brands.map((b) => [b.retailId, b.name, b.slug]),
    source: 'SELECT RetailId, Name, Slug FROM #S',
    key: ['RetailId'],
    update: ['Name', 'Slug'],
  })

  await merge(tx, counts, {
    target: 'Categories',
    stage: [['EcwidCategoryId', 'BIGINT'], ['ParentEcwidId', 'BIGINT'], ['Name', 'NVARCHAR(200)'], ['Slug', 'NVARCHAR(220)'], ['SortOrder', 'INT'],
      ['IsEnabled', 'BIT'], ['IsHidden', 'BIT'], ['ImageSourceUrl', 'VARCHAR(400)'], ['RetailId', 'VARCHAR(40)']],
    rows: c.categories.map((x) => [x.ecwidCategoryId, x.parentEcwidCategoryId, x.name, x.slug, x.sortOrder, x.isEnabled, x.isHidden, x.imageSourceUrl, x.retailId]),
    source: 'SELECT EcwidCategoryId, Name, Slug, SortOrder, IsEnabled, IsHidden, ImageSourceUrl, RetailId FROM #S',
    key: ['EcwidCategoryId'],
    update: ['Name', 'Slug', 'SortOrder', 'IsEnabled', 'ImageSourceUrl', 'RetailId'],
    insertOnly: ['IsHidden'],
    // A new picture address means the saved file is out of date.
    set: `, ImageKey = CASE WHEN ISNULL(t.ImageSourceUrl, '') <> ISNULL(s.ImageSourceUrl, '') THEN NULL ELSE t.ImageKey END`,
    after: `UPDATE c SET ParentId = p.Id
            FROM dbo.Categories c JOIN #S s ON s.EcwidCategoryId = c.EcwidCategoryId
            LEFT JOIN dbo.Categories p ON p.EcwidCategoryId = s.ParentEcwidId
            WHERE ISNULL(c.ParentId, 0) <> ISNULL(p.Id, 0)`,
  })

  await merge(tx, counts, {
    target: 'Products',
    stage: [['RetailId', 'VARCHAR(40)'], ['EcwidProductId', 'BIGINT'], ['Name', 'NVARCHAR(300)'], ['Slug', 'NVARCHAR(320)'], ['DescriptionHtml', 'NVARCHAR(MAX)'],
      ['BrandRetailId', 'VARCHAR(40)'], ['IsEnabled', 'BIT'], ['DefaultEcwidCategoryId', 'BIGINT'], ['SeoTitle', 'NVARCHAR(300)'],
      ['SeoDescription', 'NVARCHAR(MAX)'], ['SearchTags', 'NVARCHAR(MAX)'], ['SourceUpdatedAt', 'DATETIME2(0)']],
    rows: c.products.map((p) => [p.retailId, p.ecwidProductId, p.name, p.slug, p.descriptionHtml, p.brandRetailId, p.isEnabled, p.defaultEcwidCategoryId,
      p.seoTitle, p.seoDescription, p.searchTags, p.sourceUpdatedAt]),
    source: `SELECT s.RetailId, s.EcwidProductId, s.Name, s.Slug, s.DescriptionHtml, b.Id AS BrandId, s.IsEnabled, c.Id AS DefaultCategoryId,
                    s.SeoTitle, s.SeoDescription, s.SearchTags, s.SourceUpdatedAt
             FROM #S s LEFT JOIN dbo.Brands b ON b.RetailId = s.BrandRetailId LEFT JOIN dbo.Categories c ON c.EcwidCategoryId = s.DefaultEcwidCategoryId`,
    key: ['RetailId'],
    update: ['EcwidProductId', 'Name', 'Slug', 'DescriptionHtml', 'BrandId', 'IsEnabled', 'DefaultCategoryId', 'SeoTitle', 'SeoDescription', 'SearchTags', 'SourceUpdatedAt'],
    touch: true,
    missing: { where: 't.RetailId IS NOT NULL', flag: 'IsEnabled' },
  })

  await merge(tx, counts, {
    target: 'ProductVariants',
    stage: [['RetailId', 'VARCHAR(40)'], ['ProductRetailId', 'VARCHAR(40)'], ['EcwidCombinationId', 'BIGINT'], ['Sku', 'NVARCHAR(100)'], ['Name', 'NVARCHAR(300)'],
      ['Price', 'DECIMAL(12,5)'], ['Cost', 'DECIMAL(12,5)'], ['SupplierCode', 'NVARCHAR(100)'], ['Barcode', 'NVARCHAR(60)'], ['WeightLb', 'DECIMAL(10,3)'],
      ['LengthIn', 'DECIMAL(10,3)'], ['WidthIn', 'DECIMAL(10,3)'], ['HeightIn', 'DECIMAL(10,3)'], ['IsDefault', 'BIT'], ['IsEnabled', 'BIT'], ['SortOrder', 'INT']],
    rows: c.variants.map((v) => [v.retailId, v.productRetailId, v.ecwidCombinationId, v.sku, v.name, round(v.price, 5), round(v.cost, 5), v.supplierCode, v.barcode,
      round(v.weightLb, 3), round(v.lengthIn, 3), round(v.widthIn, 3), round(v.heightIn, 3), v.isDefault, v.isEnabled, v.sortOrder]),
    source: `SELECT s.RetailId, p.Id AS ProductId, s.EcwidCombinationId, s.Sku, s.Name, s.Price, s.Cost, s.SupplierCode, s.Barcode, s.WeightLb,
                    s.LengthIn, s.WidthIn, s.HeightIn, s.IsDefault, s.IsEnabled, s.SortOrder
             FROM #S s JOIN dbo.Products p ON p.RetailId = s.ProductRetailId`,
    key: ['RetailId'],
    update: ['ProductId', 'EcwidCombinationId', 'Sku', 'Name', 'Price', 'Cost', 'SupplierCode', 'Barcode', 'WeightLb', 'LengthIn', 'WidthIn', 'HeightIn', 'IsDefault', 'IsEnabled', 'SortOrder'],
    touch: true,
    missing: { where: 't.RetailId IS NOT NULL', flag: 'IsEnabled' },
  })

  await merge(tx, counts, {
    target: 'VariantOptions',
    stage: [['VariantRetailId', 'VARCHAR(40)'], ['Name', 'NVARCHAR(60)'], ['Value', 'NVARCHAR(200)'], ['SortOrder', 'INT']],
    rows: c.variantOptions.map((o) => [o.variantRetailId, o.name, o.value, o.sortOrder]),
    source: 'SELECT v.Id AS VariantId, s.Name, s.Value, s.SortOrder FROM #S s JOIN dbo.ProductVariants v ON v.RetailId = s.VariantRetailId',
    key: ['VariantId', 'Name'],
    update: ['Value', 'SortOrder'],
    deleteWhen: `t.VariantId IN ${IMPORTED_VARIANTS}`,
  })

  await merge(tx, counts, {
    target: 'ProductCategories',
    stage: [['ProductRetailId', 'VARCHAR(40)'], ['EcwidCategoryId', 'BIGINT']],
    rows: c.productCategories.map((x) => [x.productRetailId, x.ecwidCategoryId]),
    source: `SELECT p.Id AS ProductId, c.Id AS CategoryId FROM #S s JOIN dbo.Products p ON p.RetailId = s.ProductRetailId
             JOIN dbo.Categories c ON c.EcwidCategoryId = s.EcwidCategoryId`,
    key: ['ProductId', 'CategoryId'],
    deleteWhen: `t.ProductId IN ${IMPORTED_PRODUCTS}`,
  })

  await merge(tx, counts, {
    target: 'ProductImages',
    stage: [['ProductRetailId', 'VARCHAR(40)'], ['VariantRetailId', 'VARCHAR(40)'], ['SortOrder', 'INT'], ['SourceUrl', 'VARCHAR(400)'], ['ThumbSourceUrl', 'VARCHAR(400)']],
    rows: c.images.map((i) => [i.productRetailId, i.variantRetailId, i.sortOrder, i.sourceUrl, i.thumbSourceUrl]),
    source: `SELECT p.Id AS ProductId, v.Id AS VariantId, s.SortOrder, s.SourceUrl, s.ThumbSourceUrl
             FROM #S s JOIN dbo.Products p ON p.RetailId = s.ProductRetailId LEFT JOIN dbo.ProductVariants v ON v.RetailId = s.VariantRetailId`,
    key: ['ProductId', 'SourceUrl'],
    update: ['VariantId', 'SortOrder', 'ThumbSourceUrl'],
    deleteWhen: `t.SourceUrl IS NOT NULL AND t.ProductId IN ${IMPORTED_PRODUCTS}`,
  })

  await merge(tx, counts, {
    target: 'Inventory',
    stage: [['VariantRetailId', 'VARCHAR(40)'], ['QtyOnHand', 'INT'], ['TrackStock', 'BIT'], ['ReorderPoint', 'INT']],
    rows: c.inventory.map((i) => [i.variantRetailId, i.qtyOnHand, i.trackStock, i.reorderPoint == null ? null : Math.trunc(i.reorderPoint)]),
    source: 'SELECT v.Id AS VariantId, s.QtyOnHand, s.TrackStock, s.ReorderPoint FROM #S s JOIN dbo.ProductVariants v ON v.RetailId = s.VariantRetailId',
    key: ['VariantId'],
    update: ['QtyOnHand', 'TrackStock', 'ReorderPoint'],
  })

  const changed = ['Brands', 'Categories', 'Products', 'ProductVariants', 'VariantOptions', 'ProductCategories', 'ProductImages', 'Inventory']
    .some((name) => counts[name].inserted + counts[name].updated + counts[name].deleted + (counts[name].disabled ?? 0) > 0)
  if (changed) await new sql.Request(tx).batch('UPDATE dbo.CatalogVersion SET Version = Version + 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = 1')
}

async function importPricing(tx, counts, notes) {
  const [priceBooks, priceBookProducts, promotions, retailGroups, ecomGroups] = await Promise.all([
    retail('price_books'), retail('price_book_products'), retail('promotions'), retail('customer_groups'), ecom('customer_groups'),
  ])
  const variantRetailIds = new Set((await new sql.Request(tx).query('SELECT RetailId FROM dbo.ProductVariants WHERE RetailId IS NOT NULL')).recordset.map((r) => r.RetailId))
  const p = buildPricing({ priceBooks, priceBookProducts, promotions, variantRetailIds })
  const { groups } = buildCustomers({ retailGroups, retailCustomers: [], ecomGroups })
  notes.push(`Price book lines left out: ${p.skipped.unknownProduct} for products not in the catalog, ${p.skipped.zeroPrice} with a zero price, ${p.skipped.duplicate} repeats, ${p.skipped.otherBook} from the base (list price) book`)

  await merge(tx, counts, {
    target: 'PriceLists',
    stage: [['RetailId', 'VARCHAR(40)'], ['Name', 'NVARCHAR(200)'], ['LightspeedPlatform', 'NVARCHAR(40)']],
    rows: p.priceLists.map((l) => [l.retailId, l.name, l.platform]),
    source: 'SELECT RetailId, Name, LightspeedPlatform FROM #S',
    key: ['RetailId'],
    update: ['Name', 'LightspeedPlatform'],
  })

  await merge(tx, counts, {
    target: 'CustomerGroups',
    stage: [['RetailId', 'VARCHAR(40)'], ['EcwidGroupId', 'BIGINT'], ['Name', 'NVARCHAR(200)'], ['DiscountPercent', 'DECIMAL(6,3)'],
      ['DiscountName', 'NVARCHAR(200)'], ['PriceListRetailId', 'VARCHAR(40)']],
    rows: groups.map((g) => {
      const discount = p.groupDiscounts.get(g.retailId)
      return [g.retailId, g.ecwidGroupId, g.name, discount?.percent ?? 0, discount?.name ?? null, p.groupPriceLists.get(g.retailId) ?? null]
    }),
    source: `SELECT s.RetailId, s.EcwidGroupId, s.Name, s.DiscountPercent, s.DiscountName, l.Id AS PriceListId
             FROM #S s LEFT JOIN dbo.PriceLists l ON l.RetailId = s.PriceListRetailId`,
    key: ['RetailId'],
    update: ['EcwidGroupId', 'Name', 'DiscountPercent', 'DiscountName', 'PriceListId'],
  })

  const exclusions = [...p.groupDiscounts].flatMap(([groupId, d]) => d.excludedCategoryRetailIds.map((categoryId) => [groupId, categoryId]))
  await merge(tx, counts, {
    target: 'GroupDiscountExclusions',
    stage: [['GroupRetailId', 'VARCHAR(40)'], ['CategoryRetailId', 'VARCHAR(40)']],
    rows: exclusions,
    source: `SELECT g.Id AS CustomerGroupId, c.Id AS CategoryId FROM #S s JOIN dbo.CustomerGroups g ON g.RetailId = s.GroupRetailId
             JOIN dbo.Categories c ON c.RetailId = s.CategoryRetailId`,
    key: ['CustomerGroupId', 'CategoryId'],
    deleteWhen: 't.CustomerGroupId IN (SELECT Id FROM dbo.CustomerGroups WHERE RetailId IS NOT NULL)',
  })

  await merge(tx, counts, {
    target: 'PriceListItems',
    stage: [['PriceListRetailId', 'VARCHAR(40)'], ['VariantRetailId', 'VARCHAR(40)'], ['Price', 'DECIMAL(12,5)']],
    rows: p.priceListItems.map((i) => [i.priceListRetailId, i.variantRetailId, round(i.price, 5)]),
    source: `SELECT l.Id AS PriceListId, v.Id AS VariantId, s.Price FROM #S s JOIN dbo.PriceLists l ON l.RetailId = s.PriceListRetailId
             JOIN dbo.ProductVariants v ON v.RetailId = s.VariantRetailId WHERE s.Price > 0`,
    key: ['PriceListId', 'VariantId'],
    update: ['Price'],
    deleteWhen: 't.PriceListId IN (SELECT Id FROM dbo.PriceLists WHERE RetailId IS NOT NULL)',
  })
}

async function importCustomers(tx, counts, notes) {
  const [retailGroups, retailCustomers, ecomGroups] = await Promise.all([retail('customer_groups'), retail('customers'), ecom('customer_groups')])
  const c = buildCustomers({ retailGroups, retailCustomers, ecomGroups })
  const emails = new Map()
  for (const customer of c.customers) if (customer.email) emails.set(customer.email, (emails.get(customer.email) ?? 0) + 1)
  notes.push(`Customers: ${c.customers.filter((x) => !x.email).length} without an email, ${[...emails.values()].filter((n) => n > 1).length} emails shared by more than one customer`)

  // Groups are created here too (without pricing) so customers can be imported on their own.
  await merge(tx, counts, {
    target: 'CustomerGroups',
    stage: [['RetailId', 'VARCHAR(40)'], ['EcwidGroupId', 'BIGINT'], ['Name', 'NVARCHAR(200)']],
    rows: c.groups.map((g) => [g.retailId, g.ecwidGroupId, g.name]),
    source: 'SELECT RetailId, EcwidGroupId, Name FROM #S',
    key: ['RetailId'],
    update: ['EcwidGroupId', 'Name'],
  })

  await merge(tx, counts, {
    target: 'Customers',
    stage: [['RetailId', 'VARCHAR(40)'], ['CustomerCode', 'NVARCHAR(60)'], ['Email', 'NVARCHAR(254)'], ['Name', 'NVARCHAR(200)'], ['FirstName', 'NVARCHAR(100)'],
      ['LastName', 'NVARCHAR(100)'], ['CompanyName', 'NVARCHAR(200)'], ['Phone', 'NVARCHAR(50)'], ['Mobile', 'NVARCHAR(50)'], ['GroupRetailId', 'VARCHAR(40)'],
      ['OnAccountLimit', 'DECIMAL(12,2)'], ['StaffNotes', 'NVARCHAR(MAX)'], ['SourceUpdatedAt', 'DATETIME2(0)']],
    rows: c.customers.map((x) => [x.retailId, x.customerCode, x.email, x.name, x.firstName, x.lastName, x.companyName, x.phone, x.mobile, x.groupRetailId,
      round(x.onAccountLimit, 2), x.staffNotes, x.sourceUpdatedAt]),
    source: `SELECT s.RetailId, s.CustomerCode, s.Email, s.Name, s.FirstName, s.LastName, s.CompanyName, s.Phone, s.Mobile, g.Id AS CustomerGroupId,
                    s.OnAccountLimit, s.StaffNotes, s.SourceUpdatedAt
             FROM #S s LEFT JOIN dbo.CustomerGroups g ON g.RetailId = s.GroupRetailId`,
    key: ['RetailId'],
    update: ['CustomerCode', 'Email', 'Name', 'FirstName', 'LastName', 'CompanyName', 'Phone', 'Mobile', 'CustomerGroupId', 'OnAccountLimit', 'StaffNotes', 'SourceUpdatedAt'],
    touch: true,
    missing: { where: 't.RetailId IS NOT NULL', flag: 'IsActive' },
    // Website accounts already linked to a Lightspeed customer keep that link.
    after: `UPDATE c SET UserId = lc.UserId, EcwidCustomerId = lc.EcwidCustomerId
            FROM dbo.Customers c JOIN dbo.LightspeedCustomers lc ON lc.ExternalReferenceId = c.RetailId
            WHERE c.UserId IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.Customers o WHERE o.UserId = lc.UserId)`,
  })

  await merge(tx, counts, {
    target: 'CustomerAddresses',
    stage: [['CustomerRetailId', 'VARCHAR(40)'], ['LightspeedKind', 'VARCHAR(10)'], ['Street1', 'NVARCHAR(300)'], ['Street2', 'NVARCHAR(300)'], ['City', 'NVARCHAR(100)'],
      ['StateCode', 'NVARCHAR(20)'], ['PostalCode', 'NVARCHAR(20)'], ['CountryCode', 'CHAR(2)']],
    rows: c.addresses.map((a) => [a.customerRetailId, a.kind, a.street1, a.street2, a.city, a.stateCode, a.postalCode, a.countryCode]),
    source: `SELECT c.Id AS CustomerId, s.LightspeedKind, s.LightspeedKind AS Kind, CAST(1 AS BIT) AS IsDefault, s.Street1, s.Street2, s.City, s.StateCode, s.PostalCode, s.CountryCode
             FROM #S s JOIN dbo.Customers c ON c.RetailId = s.CustomerRetailId`,
    key: ['CustomerId', 'LightspeedKind'],
    update: ['Street1', 'Street2', 'City', 'StateCode', 'PostalCode', 'CountryCode'],
    insertOnly: ['Kind', 'IsDefault'],
    deleteWhen: 't.LightspeedKind IS NOT NULL AND t.CustomerId IN (SELECT Id FROM dbo.Customers WHERE RetailId IS NOT NULL)',
  })
}

// ---- Photos ------------------------------------------------------------------
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }

/** Downloads one picture into MEDIA_DIR and returns its key (folder/ab/<sha256>.ext), or null. */
async function download(url, folder) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  const extension = EXTENSIONS[(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()]
  if (!response.ok || !extension) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) return null
  const hash = createHash('sha256').update(bytes).digest('hex')
  const key = `${folder}/${hash.slice(0, 2)}/${hash}${extension}`
  const file = path.join(mediaDir, key)
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
  return key
}

async function downloadImages(pool, notes) {
  const jobs = []
  const images = (await pool.request().query('SELECT Id, SourceUrl, ThumbSourceUrl, FileKey, ThumbKey FROM dbo.ProductImages WHERE SourceUrl IS NOT NULL AND (FileKey IS NULL OR (ThumbKey IS NULL AND ThumbSourceUrl IS NOT NULL))')).recordset
  for (const row of images) {
    if (!row.FileKey) jobs.push({ url: row.SourceUrl, folder: 'p', save: (key) => pool.request().input('Id', sql.Int, row.Id).input('Key', sql.VarChar(120), key).query('UPDATE dbo.ProductImages SET FileKey = @Key WHERE Id = @Id') })
    if (!row.ThumbKey && row.ThumbSourceUrl) jobs.push({ url: row.ThumbSourceUrl, folder: 'p', save: (key) => pool.request().input('Id', sql.Int, row.Id).input('Key', sql.VarChar(120), key).query('UPDATE dbo.ProductImages SET ThumbKey = @Key WHERE Id = @Id') })
  }
  const categories = (await pool.request().query('SELECT Id, ImageSourceUrl FROM dbo.Categories WHERE ImageSourceUrl IS NOT NULL AND ImageKey IS NULL')).recordset
  for (const row of categories) {
    jobs.push({ url: row.ImageSourceUrl, folder: 'c', save: (key) => pool.request().input('Id', sql.Int, row.Id).input('Key', sql.VarChar(120), key).query('UPDATE dbo.Categories SET ImageKey = @Key WHERE Id = @Id') })
  }
  let done = 0
  let failed = 0
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const key = await download(job.url, job.folder)
        if (key) { await job.save(key); done++ } else failed++
      } catch {
        failed++
      }
      if ((done + failed) % 250 === 0) console.log(`  photos: ${done} saved, ${failed} failed, ${jobs.length} to go`)
    }
  }
  const total = jobs.length
  await Promise.all(Array.from({ length: 6 }, worker))
  notes.push(`Photos: ${done} of ${total} downloaded to ${mediaDir}${failed ? `, ${failed} failed (run again to retry)` : ''}`)
  if (done) await pool.request().batch('UPDATE dbo.CatalogVersion SET Version = Version + 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = 1')
}

// ---- Run ---------------------------------------------------------------------
if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('Set DB_USER and DB_PASSWORD in .env.local.')
  process.exit(1)
}
const pool = await new sql.ConnectionPool({
  server: process.env.DB_SERVER || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  database: process.env.DB_NAME || 'WOODYS_IND',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  requestTimeout: 300_000,
  options: { encrypt: true, trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false' },
}).connect()

const startedAt = new Date()
const counts = {}
const notes = []
let failure = null
console.log(`Lightspeed import${dryRun ? ' (dry run: nothing is saved)' : ''} — ${only.join(', ')} — ${fromDump ? `from ${dumpDir}` : 'live from Lightspeed'}`)

const tx = new sql.Transaction(pool)
await tx.begin()
try {
  // Order matters: pricing points at variants, customers at groups.
  if (only.includes('catalog')) await importCatalog(tx, counts, notes)
  if (only.includes('pricing')) await importPricing(tx, counts, notes)
  if (only.includes('customers')) await importCustomers(tx, counts, notes)
  if (dryRun) await tx.rollback()
  else await tx.commit()
} catch (error) {
  failure = error
  await tx.rollback().catch(() => {})
}

if (!failure && !dryRun && withImages) await downloadImages(pool, notes).catch((error) => { failure = error })

console.log('\nTable                      from Lightspeed   added  changed  removed  no longer in Lightspeed')
for (const [name, c] of Object.entries(counts)) {
  console.log(`${name.padEnd(26)} ${String(c.source).padStart(15)} ${String(c.inserted).padStart(7)} ${String(c.updated).padStart(8)} ${String(c.deleted).padStart(8)}  ${c.missing == null ? '' : c.missing}${c.disabled ? ` (${c.disabled} switched off)` : ''}`)
}
notes.forEach((note) => console.log(note))
if (failure) console.error(`\nFAILED, nothing was saved: ${failure.message}`)
else console.log(dryRun ? '\nDry run finished; nothing was saved.' : '\nImport finished.')

await pool.request()
  .input('Kind', sql.VarChar(60), only.join(',') + (withImages ? '+images' : ''))
  .input('DryRun', sql.Bit, dryRun)
  .input('StartedAt', sql.DateTime2(0), startedAt)
  .input('Status', sql.VarChar(10), failure ? 'failed' : 'ok')
  .input('CountsJson', sql.NVarChar(sql.MAX), JSON.stringify({ counts, notes }))
  .input('Error', sql.NVarChar(sql.MAX), failure ? String(failure.message) : null)
  .query('INSERT dbo.ImportRuns (Kind, DryRun, StartedAt, FinishedAt, Status, CountsJson, Error) VALUES (@Kind, @DryRun, @StartedAt, SYSUTCDATETIME(), @Status, @CountsJson, @Error)')
  .catch((error) => console.error(`Could not record the run: ${error.message}`))
await pool.close()
process.exit(failure ? 1 : 0)
