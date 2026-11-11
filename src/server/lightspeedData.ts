/*
 * Turns what Lightspeed eCom (Ecwid) returns for a customer, plus the store's
 * promotions, into the row saved in dbo.LightspeedCustomers
 * (db/003_lightspeed_data.sql). No database or network here, so it can be
 * unit-tested.
 */

/** A customer as GET /customers/{id} returns it. Only the fields read here are typed. */
export type EcwidCustomerRaw = {
  id?: number
  externalReferenceId?: string
  email?: string
  registered?: string
  updated?: string
  billingPerson?: {
    name?: string
    firstName?: string
    lastName?: string
    companyName?: string
    street?: string
    city?: string
    countryCode?: string
    postalCode?: string
    stateOrProvinceCode?: string
    phone?: string
  }
  shippingAddresses?: unknown[]
  contacts?: unknown[]
  customerGroupId?: number
  customerGroupName?: string
  taxExempt?: boolean
  taxId?: string
  b2b_b2c?: string
  acceptMarketing?: boolean
  lang?: string
  stats?: {
    numberOfOrders?: number
    numberOfCanceledOrders?: number
    salesValue?: number
    averageOrderValue?: number
  }
} & Record<string, unknown>

/** A promotion as GET /promotions returns it. */
export type EcwidPromotion = {
  id?: number
  name?: string
  description?: string
  enabled?: boolean
  discountType?: string
  amount?: number
  triggers?: {
    startDate?: string
    endDate?: string
    customerGroups?: number[]
  }
} & Record<string, unknown>

export type CustomerRecord = {
  ecwidCustomerId: number
  externalReferenceId: string | null
  email: string | null
  name: string | null
  firstName: string | null
  lastName: string | null
  companyName: string | null
  phone: string | null
  street: string | null
  city: string | null
  stateCode: string | null
  postalCode: string | null
  countryCode: string | null
  customerGroupId: number | null
  customerGroupName: string | null
  discountPercent: number | null
  discountName: string | null
  discountDescription: string | null
  taxExempt: boolean | null
  taxId: string | null
  customerType: string | null
  acceptMarketing: boolean | null
  lang: string | null
  orderCount: number | null
  canceledOrderCount: number | null
  salesValue: number | null
  averageOrderValue: number | null
  registeredAt: Date | null
  lightspeedUpdatedAt: Date | null
  shippingAddressesJson: string
  contactsJson: string
  promotionsJson: string
  rawJson: string
}

/** Lightspeed dates look like "2026-10-01 04:00:00 +0000". Null if missing or unreadable. */
export function parseEcwidDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(?:([+-])(\d{2}):?(\d{2})|Z)?$/)
  const date = match
    ? new Date(`${match[1]}T${match[2]}${match[3] ? `${match[3]}${match[4]}:${match[5]}` : 'Z'}`)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Trimmed text cut to the column's width; empty becomes null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

/**
 * The promotions that apply to a customer group right now: switched on,
 * aimed at that group, and inside their start/end dates.
 */
export function promotionsForGroup(promotions: EcwidPromotion[], groupId: number | null, now: Date): EcwidPromotion[] {
  if (!groupId) return []
  return promotions.filter((promotion) => {
    if (promotion.enabled === false) return false
    if (!promotion.triggers?.customerGroups?.includes(groupId)) return false
    const start = parseEcwidDate(promotion.triggers.startDate)
    const end = parseEcwidDate(promotion.triggers.endDate)
    return (!start || start <= now) && (!end || end >= now)
  })
}

export function toCustomerRecord(raw: EcwidCustomerRaw, promotions: EcwidPromotion[], now = new Date()): CustomerRecord {
  if (typeof raw.id !== 'number') throw new Error('Lightspeed customer has no id')
  const person = raw.billingPerson ?? {}
  // Group 0 is Lightspeed's "General": no special pricing.
  const groupId = raw.customerGroupId ? raw.customerGroupId : null
  const applying = promotionsForGroup(promotions, groupId, now)
  // The headline discount: the largest percent-off promotion for the group.
  const best = applying
    .filter((promotion) => promotion.discountType === 'PERCENT' && typeof promotion.amount === 'number')
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]

  return {
    ecwidCustomerId: raw.id,
    externalReferenceId: text(raw.externalReferenceId, 100),
    email: text(raw.email, 254)?.toLowerCase() ?? null,
    name: text(person.name, 200),
    firstName: text(person.firstName, 100),
    lastName: text(person.lastName, 100),
    companyName: text(person.companyName, 200),
    phone: text(person.phone, 50),
    street: text(person.street, 300),
    city: text(person.city, 100),
    stateCode: text(person.stateOrProvinceCode, 20),
    postalCode: text(person.postalCode, 20),
    countryCode: text(person.countryCode, 5),
    customerGroupId: groupId,
    customerGroupName: groupId ? text(raw.customerGroupName, 200) : null,
    discountPercent: best ? (best.amount ?? null) : null,
    discountName: best ? text(best.name, 200) : null,
    discountDescription: best ? text(best.description, 500) : null,
    taxExempt: flag(raw.taxExempt),
    taxId: text(raw.taxId, 100),
    customerType: text(raw.b2b_b2c, 10),
    acceptMarketing: flag(raw.acceptMarketing),
    lang: text(raw.lang, 10),
    orderCount: number(raw.stats?.numberOfOrders),
    canceledOrderCount: number(raw.stats?.numberOfCanceledOrders),
    salesValue: number(raw.stats?.salesValue),
    averageOrderValue: number(raw.stats?.averageOrderValue),
    registeredAt: parseEcwidDate(raw.registered),
    lightspeedUpdatedAt: parseEcwidDate(raw.updated),
    shippingAddressesJson: JSON.stringify(raw.shippingAddresses ?? []),
    contactsJson: JSON.stringify(raw.contacts ?? []),
    promotionsJson: JSON.stringify(applying),
    rawJson: JSON.stringify(raw),
  }
}
