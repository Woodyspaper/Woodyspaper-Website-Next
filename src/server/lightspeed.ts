import 'server-only'
import { HttpError, withRetry } from '../services/retry'
import { consumeCode, sendCode } from './accounts'
import { query, sql } from './db'
import { buildSsoPayload } from './ecwidSso'
import { ApiError } from './http'
import { toCustomerRecord } from './lightspeedData'
import type { EcwidCustomerRaw, EcwidPromotion } from './lightspeedData'
import { limit } from './rateLimit'
import type { SessionUser } from './sessions'

/*
 * The website account's connection to a Lightspeed eCom (Ecwid) customer.
 *
 * Two kinds (LightspeedLinks.Method):
 *   linked — a customer that already existed in Lightspeed. Ownership is
 *            proven with a code emailed to that customer's address. The site
 *            shows their details and pricing group; at checkout they sign in
 *            to the store with Lightspeed's own emailed code, because
 *            Lightspeed's single sign-on can't attach to an existing customer.
 *   sso    — a store account created through the website. The site signs
 *            them in to the store automatically (see ecwidSso.ts).
 *
 * Lightspeed is called with the store's secret token, which must stay on the
 * server (LIGHTSPEED_SECRET_TOKEN, needs the read_customers scope).
 */

export type StoreCustomer = {
  id: number
  email: string
  name: string
  /** Customer group that sets their pricing; null = standard pricing. */
  groupName: string | null
}

type EcwidCustomer = {
  id?: number
  email?: string
  customerGroupId?: number
  customerGroupName?: string
  billingPerson?: { name?: string }
}

async function ecwid<T>(path: string): Promise<T | null> {
  const storeId = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID
  const token = process.env.LIGHTSPEED_SECRET_TOKEN
  if (!storeId || !token) throw new Error('Lightspeed is not configured: set LIGHTSPEED_SECRET_TOKEN.')
  // Every call here is a read, so a dropped connection, a timeout or a busy
  // Lightspeed is tried again: three tries in all (services/retry.ts).
  return withRetry(async () => {
    const response = await fetch(`https://app.ecwid.com/api/v3/${storeId}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new HttpError(response.status, `Lightspeed API ${path.split('?')[0]} answered ${response.status}`)
    return (await response.json()) as T
  })
}

function toStoreCustomer(customer: EcwidCustomer | null | undefined): StoreCustomer | null {
  if (!customer?.id || !customer.email) return null
  return {
    id: customer.id,
    email: customer.email.toLowerCase(),
    name: customer.billingPerson?.name?.trim() ?? '',
    // Group 0 is Lightspeed's "General" (no special pricing).
    groupName: customer.customerGroupId ? (customer.customerGroupName ?? null) : null,
  }
}

export async function findStoreCustomerByEmail(email: string): Promise<StoreCustomer | null> {
  const result = await ecwid<{ items?: EcwidCustomer[] }>(
    `customers?email=${encodeURIComponent(email)}&useExactEmailMatch=true&limit=5`,
  )
  // Don't rely on the exact-match flag alone.
  return toStoreCustomer(result?.items?.find((item) => item.email?.toLowerCase() === email))
}

/**
 * Reads the customer's full record and the store's promotions from Lightspeed,
 * saves a copy in dbo.LightspeedCustomers (db/003_lightspeed_data.sql), and
 * returns the customer. The copy holds their pricing group, the discount that
 * group gets, contact and address details and order totals; Lightspeed stays
 * the source of truth. Null if Lightspeed no longer has the customer.
 */
export async function syncStoreCustomer(userId: number, customerId: number): Promise<StoreCustomer | null> {
  const [raw, promotions] = await Promise.all([
    ecwid<EcwidCustomerRaw>(`customers/${customerId}`),
    // A store has a handful of promotions; one page covers them.
    ecwid<{ items?: EcwidPromotion[] }>('promotions?limit=100'),
  ])
  const customer = toStoreCustomer(raw)
  if (!raw || !customer) return null
  const record = toCustomerRecord(raw, promotions?.items ?? [])

  await (await query())
    .input('UserId', sql.Int, userId)
    .input('EcwidCustomerId', sql.BigInt, record.ecwidCustomerId)
    .input('ExternalReferenceId', sql.NVarChar(100), record.externalReferenceId)
    .input('Email', sql.NVarChar(254), record.email)
    .input('Name', sql.NVarChar(200), record.name)
    .input('FirstName', sql.NVarChar(100), record.firstName)
    .input('LastName', sql.NVarChar(100), record.lastName)
    .input('CompanyName', sql.NVarChar(200), record.companyName)
    .input('Phone', sql.NVarChar(50), record.phone)
    .input('Street', sql.NVarChar(300), record.street)
    .input('City', sql.NVarChar(100), record.city)
    .input('StateCode', sql.NVarChar(20), record.stateCode)
    .input('PostalCode', sql.NVarChar(20), record.postalCode)
    .input('CountryCode', sql.NVarChar(5), record.countryCode)
    .input('CustomerGroupId', sql.BigInt, record.customerGroupId)
    .input('CustomerGroupName', sql.NVarChar(200), record.customerGroupName)
    .input('DiscountPercent', sql.Decimal(6, 3), record.discountPercent)
    .input('DiscountName', sql.NVarChar(200), record.discountName)
    .input('DiscountDescription', sql.NVarChar(500), record.discountDescription)
    .input('TaxExempt', sql.Bit, record.taxExempt)
    .input('TaxId', sql.NVarChar(100), record.taxId)
    .input('CustomerType', sql.VarChar(10), record.customerType)
    .input('AcceptMarketing', sql.Bit, record.acceptMarketing)
    .input('Lang', sql.NVarChar(10), record.lang)
    .input('OrderCount', sql.Int, record.orderCount)
    .input('CanceledOrderCount', sql.Int, record.canceledOrderCount)
    .input('SalesValue', sql.Decimal(18, 2), record.salesValue)
    .input('AverageOrderValue', sql.Decimal(18, 2), record.averageOrderValue)
    .input('RegisteredAt', sql.DateTime2(0), record.registeredAt)
    .input('LightspeedUpdatedAt', sql.DateTime2(0), record.lightspeedUpdatedAt)
    .input('ShippingAddressesJson', sql.NVarChar(sql.MAX), record.shippingAddressesJson)
    .input('ContactsJson', sql.NVarChar(sql.MAX), record.contactsJson)
    .input('PromotionsJson', sql.NVarChar(sql.MAX), record.promotionsJson)
    .input('RawJson', sql.NVarChar(sql.MAX), record.rawJson)
    .query(
      // Update the account's row, or add it the first time. The row can only
      // exist while the account is linked (foreign key to LightspeedLinks).
      `UPDATE dbo.LightspeedCustomers SET
         EcwidCustomerId = @EcwidCustomerId, ExternalReferenceId = @ExternalReferenceId, Email = @Email,
         Name = @Name, FirstName = @FirstName, LastName = @LastName, CompanyName = @CompanyName, Phone = @Phone,
         Street = @Street, City = @City, StateCode = @StateCode, PostalCode = @PostalCode, CountryCode = @CountryCode,
         CustomerGroupId = @CustomerGroupId, CustomerGroupName = @CustomerGroupName,
         DiscountPercent = @DiscountPercent, DiscountName = @DiscountName, DiscountDescription = @DiscountDescription,
         TaxExempt = @TaxExempt, TaxId = @TaxId, CustomerType = @CustomerType, AcceptMarketing = @AcceptMarketing, Lang = @Lang,
         OrderCount = @OrderCount, CanceledOrderCount = @CanceledOrderCount,
         SalesValue = @SalesValue, AverageOrderValue = @AverageOrderValue,
         RegisteredAt = @RegisteredAt, LightspeedUpdatedAt = @LightspeedUpdatedAt,
         ShippingAddressesJson = @ShippingAddressesJson, ContactsJson = @ContactsJson,
         PromotionsJson = @PromotionsJson, RawJson = @RawJson, SyncedAt = SYSUTCDATETIME()
       WHERE UserId = @UserId;
       IF @@ROWCOUNT = 0
         INSERT INTO dbo.LightspeedCustomers (
           UserId, EcwidCustomerId, ExternalReferenceId, Email, Name, FirstName, LastName, CompanyName, Phone,
           Street, City, StateCode, PostalCode, CountryCode, CustomerGroupId, CustomerGroupName,
           DiscountPercent, DiscountName, DiscountDescription, TaxExempt, TaxId, CustomerType, AcceptMarketing, Lang,
           OrderCount, CanceledOrderCount, SalesValue, AverageOrderValue, RegisteredAt, LightspeedUpdatedAt,
           ShippingAddressesJson, ContactsJson, PromotionsJson, RawJson)
         SELECT
           @UserId, @EcwidCustomerId, @ExternalReferenceId, @Email, @Name, @FirstName, @LastName, @CompanyName, @Phone,
           @Street, @City, @StateCode, @PostalCode, @CountryCode, @CustomerGroupId, @CustomerGroupName,
           @DiscountPercent, @DiscountName, @DiscountDescription, @TaxExempt, @TaxId, @CustomerType, @AcceptMarketing, @Lang,
           @OrderCount, @CanceledOrderCount, @SalesValue, @AverageOrderValue, @RegisteredAt, @LightspeedUpdatedAt,
           @ShippingAddressesJson, @ContactsJson, @PromotionsJson, @RawJson
         WHERE EXISTS (SELECT 1 FROM dbo.LightspeedLinks WHERE UserId = @UserId);`,
    )
  return customer
}

/** Saves the Lightspeed copy right after linking. A failure here must not undo the link: the account page retries. */
async function syncAfterLinking(userId: number, customerId: number) {
  try {
    await syncStoreCustomer(userId, customerId)
  } catch (error) {
    console.error('Saving Lightspeed customer data failed', error)
  }
}

type LinkRow = { Method: 'linked' | 'sso'; EcwidCustomerId: string | number | null; LightspeedEmail: string }

async function getLink(userId: number): Promise<LinkRow | undefined> {
  const result = await (await query())
    .input('userId', sql.Int, userId)
    .query<LinkRow>('SELECT Method, EcwidCustomerId, LightspeedEmail FROM dbo.LightspeedLinks WHERE UserId = @userId')
  return result.recordset[0]
}

const ALREADY_LINKED = 'That store account is already linked to another website account. Call us if that’s unexpected.'

async function saveLink(userId: number, method: 'linked' | 'sso', customerId: number | null, email: string) {
  try {
    await (await query())
      .input('userId', sql.Int, userId)
      .input('method', sql.VarChar(10), method)
      .input('customerId', sql.BigInt, customerId)
      .input('email', sql.NVarChar(254), email)
      .query(
        `INSERT INTO dbo.LightspeedLinks (UserId, Method, EcwidCustomerId, LightspeedEmail)
         VALUES (@userId, @method, @customerId, @email)`,
      )
  } catch (error) {
    // 2601 / 2627: unique index — this account already has a link, or the customer is taken.
    const number = (error as { number?: number }).number
    if (number === 2601 || number === 2627) throw new ApiError(409, ALREADY_LINKED)
    throw error
  }
}

export function ssoConfigured(): boolean {
  return Boolean(process.env.ECWID_SSO_CLIENT_ID && process.env.ECWID_SSO_CLIENT_SECRET)
}

/**
 * Step 1 of linking. If the address is the account's own confirmed email,
 * ownership is already proven and the link is made at once. Otherwise a code
 * goes to that address — if a store customer has it. The answer is the same
 * either way, so this can't be used to find out who our customers are.
 */
export async function startLink(user: SessionUser, email: string): Promise<{ linked: boolean }> {
  if (await getLink(user.id)) throw new ApiError(409, 'Your account is already linked to a store account.')
  await limit('link-start', String(user.id), 10, 60)
  const customer = await findStoreCustomerByEmail(email)
  if (customer && email === user.email) {
    await saveLink(user.id, 'linked', customer.id, customer.email)
    await syncAfterLinking(user.id, customer.id)
    return { linked: true }
  }
  if (customer) {
    try {
      await sendCode(user.id, 'link', customer.email, customer.id)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error // code limit reached: stay silent
    }
  }
  return { linked: false }
}

/** Step 2 of linking: the code that was emailed to the store account's address. */
export async function confirmLink(user: SessionUser, code: string): Promise<void> {
  if (await getLink(user.id)) throw new ApiError(409, 'Your account is already linked to a store account.')
  const consumed = await consumeCode(user.id, 'link', code)
  if (!consumed?.ecwidCustomerId) throw new ApiError(400, 'That code is wrong or has expired. Request a new one.')
  await saveLink(user.id, 'linked', consumed.ecwidCustomerId, consumed.targetEmail)
  await syncAfterLinking(user.id, consumed.ecwidCustomerId)
}

export async function unlink(user: SessionUser): Promise<void> {
  await (await query()).input('userId', sql.Int, user.id).query('DELETE FROM dbo.LightspeedLinks WHERE UserId = @userId')
}

/**
 * For customers new to the store: marks the account for single sign-on, and
 * Lightspeed creates the store customer the first time they open the store.
 * If the store already has a customer with their confirmed email, that one
 * is linked instead (single sign-on would be refused for it).
 */
export async function createStoreAccount(user: SessionUser): Promise<'linked' | 'sso'> {
  if (await getLink(user.id)) throw new ApiError(409, 'Your account already has a store account.')
  const existing = await findStoreCustomerByEmail(user.email)
  if (existing) {
    await saveLink(user.id, 'linked', existing.id, existing.email)
    await syncAfterLinking(user.id, existing.id)
    return 'linked'
  }
  if (!ssoConfigured()) throw new ApiError(503, 'Store accounts can’t be created from the website yet.')
  await saveLink(user.id, 'sso', null, user.email)
  return 'sso'
}

/** Whether the store should be opened in single sign-on mode for this account. */
export async function usesStoreSso(user: SessionUser): Promise<boolean> {
  if (!user.emailVerified || !ssoConfigured()) return false
  return (await getLink(user.id))?.Method === 'sso'
}

/** The signed sign-on string for the store, or null if this account doesn't use single sign-on. */
export async function getSsoPayload(user: SessionUser): Promise<string | null> {
  if (!user.emailVerified || !ssoConfigured()) return null
  const link = await getLink(user.id)
  if (link?.Method !== 'sso') return null
  return buildSsoPayload({
    clientId: process.env.ECWID_SSO_CLIENT_ID!,
    clientSecret: process.env.ECWID_SSO_CLIENT_SECRET!,
    userId: user.id,
    email: user.email,
    name: user.name,
  })
}

export type StoreAccountInfo = {
  method: 'linked' | 'sso'
  email: string
  /** Live details from Lightspeed; null if it couldn't be reached or the customer isn't created yet. */
  customer: StoreCustomer | null
}

/** What the account page shows about the store account, or null if there isn't one. */
export async function getStoreAccount(user: SessionUser): Promise<StoreAccountInfo | null> {
  const link = await getLink(user.id)
  if (!link) return null
  let customer: StoreCustomer | null = null
  try {
    if (link.EcwidCustomerId !== null) {
      // Each visit to the account page also refreshes our saved copy.
      customer = await syncStoreCustomer(user.id, Number(link.EcwidCustomerId))
    } else {
      // Single sign-on account: Lightspeed creates the customer on their first
      // store visit. Once it exists, remember its id.
      customer = await findStoreCustomerByEmail(link.LightspeedEmail)
      if (customer) {
        await (await query())
          .input('userId', sql.Int, user.id)
          .input('customerId', sql.BigInt, customer.id)
          .query(
            `UPDATE dbo.LightspeedLinks SET EcwidCustomerId = @customerId
             WHERE UserId = @userId AND EcwidCustomerId IS NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.LightspeedLinks WHERE EcwidCustomerId = @customerId)`,
          )
        customer = await syncStoreCustomer(user.id, customer.id)
      }
    }
  } catch (error) {
    console.error('Lightspeed lookup failed', error)
  }
  return { method: link.Method, email: link.LightspeedEmail, customer }
}
