/*
 * UPS shipping rates for the checkout.
 *
 *   parcelsForLines  works out the boxes an order would ship in, from each
 *                    item's weight and size (no network)
 *   quoteUps         asks UPS what those boxes cost to send to an address
 *
 * UPS's Rating API is used (version v2409, "Shop", which prices every UPS
 * service at once), signed in with OAuth client credentials. Reference:
 * https://developer.ups.com/tag/Rating and UPS's published API definitions
 * at https://github.com/UPS-API/api-documentation (Rating.yaml,
 * OAuthClientCredentials.yaml).
 *
 * Asking for a rate changes nothing at UPS and costs nothing, so unlike a
 * card charge it is safe to ask again.
 *
 * HOW ITEMS ARE BOXED (an estimate; the warehouse may pack differently)
 *   - A heavy or long item (25 lb or more, or 30 in or longer) ships as it
 *     is: one parcel per unit, with its own weight and size. A case of paper
 *     is already a shipping carton.
 *   - Lighter items are put together into shared boxes of up to 50 lb and
 *     about 3 cubic feet, heaviest first. A shared box is given the size of
 *     a cube holding its items plus 15% for packing, because UPS charges
 *     light, bulky boxes by size.
 *   - An item with no weight on file can't be priced, and an item over
 *     UPS's limits (150 lb, 108 in long, 165 in length plus girth) can't go
 *     by UPS at all. Either way the order is not offered UPS.
 *
 * Kept free of imports so the tests can run it with a stand-in for `fetch`.
 */

export interface ShippableLine {
  quantity: number
  /** Of one unit. Null or missing when we don't hold it. */
  weightLb?: number | null
  lengthIn?: number | null
  widthIn?: number | null
  heightIn?: number | null
}

export interface Parcel {
  weightLb: number
  /** Longest side first. Left out when the sizes of what is inside aren't known. */
  lengthIn?: number
  widthIn?: number
  heightIn?: number
}

export interface PackingRules {
  /** An item at or over this weight ships in its own parcel. */
  shipsAloneLb: number
  /** An item with a side at or over this length ships in its own parcel. */
  shipsAloneIn: number
  /** The most a shared box may weigh. */
  sharedBoxMaxLb: number
  /** The most a shared box may hold, in cubic inches. */
  sharedBoxMaxCubicIn: number
  /** Extra room allowed for packing in a shared box: 0.15 = 15%. */
  packingAllowance: number
  /** More parcels than this is a freight order, not a UPS one. */
  maxParcels: number
}

export const DEFAULT_PACKING_RULES: PackingRules = {
  shipsAloneLb: 25,
  shipsAloneIn: 30,
  sharedBoxMaxLb: 50,
  sharedBoxMaxCubicIn: 5184, // 24 x 18 x 12 in, 3 cubic feet
  packingAllowance: 0.15,
  maxParcels: 50,
}

// UPS's limits for one package.
const UPS_MAX_LB = 150
const UPS_MAX_LENGTH_IN = 108
const UPS_MAX_LENGTH_PLUS_GIRTH_IN = 165

export type ParcelsResult =
  | { ok: true; parcels: Parcel[]; totalWeightLb: number }
  | {
      ok: false
      /** Safe to show the customer. */
      error: string
      /** Which lines (counting from 0) are the trouble. */
      lines: number[]
      reason: 'no_weight' | 'too_big' | 'too_many' | 'bad_quantity'
    }

const positive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const roundUp = (value: number, places: number) => Math.ceil(value * 10 ** places - 1e-9) / 10 ** places || 0

/** The parcels an order would ship in, by the boxing rules at the top of this file. */
export function parcelsForLines(lines: readonly ShippableLine[], rules: PackingRules = DEFAULT_PACKING_RULES): ParcelsResult {
  const badQuantity = lines.flatMap((line, index) => (Number.isSafeInteger(line.quantity) && line.quantity > 0 ? [] : [index]))
  if (badQuantity.length > 0) return { ok: false, error: 'Something in this order has no quantity.', lines: badQuantity, reason: 'bad_quantity' }
  const noWeight = lines.flatMap((line, index) => (positive(line.weightLb) ? [] : [index]))
  if (noWeight.length > 0) {
    return { ok: false, error: 'Something in this order can’t be shipped by UPS. Choose warehouse pickup, or call us to arrange delivery.', lines: noWeight, reason: 'no_weight' }
  }

  const parcels: Parcel[] = []
  const loose: { weightLb: number; cubicIn: number | null }[] = []
  const tooBig: number[] = []
  let units = 0
  for (const [index, line] of lines.entries()) {
    const weightLb = line.weightLb as number
    const sides = [line.lengthIn, line.widthIn, line.heightIn]
    const sized = sides.every(positive)
    const [longest, middle, shortest] = sized ? (sides as number[]).slice().sort((a, b) => b - a) : [0, 0, 0]
    if (weightLb > UPS_MAX_LB || longest > UPS_MAX_LENGTH_IN || longest + 2 * (middle + shortest) > UPS_MAX_LENGTH_PLUS_GIRTH_IN) {
      tooBig.push(index)
      continue
    }
    units += line.quantity
    if (units > 100000) return { ok: false, error: 'This order is too large to ship by UPS. Please call us to arrange delivery.', lines: [index], reason: 'too_many' }
    const alone = weightLb >= rules.shipsAloneLb || longest >= rules.shipsAloneIn
    for (let unit = 0; unit < line.quantity; unit++) {
      if (alone) parcels.push(sized ? { weightLb, lengthIn: longest, widthIn: middle, heightIn: shortest } : { weightLb })
      else loose.push({ weightLb, cubicIn: sized ? longest * middle * shortest : null })
      if (parcels.length > rules.maxParcels) return { ok: false, error: 'This order is too large to ship by UPS. Please call us to arrange delivery.', lines: [index], reason: 'too_many' }
    }
  }
  if (tooBig.length > 0) {
    return { ok: false, error: 'Something in this order is too large or heavy for UPS. Choose warehouse pickup, or call us to arrange delivery.', lines: tooBig, reason: 'too_big' }
  }

  // Shared boxes: heaviest first, each item into the first box with room.
  const boxes: { weightLb: number; cubicIn: number; sized: boolean }[] = []
  loose.sort((a, b) => b.weightLb - a.weightLb)
  for (const item of loose) {
    const cubicIn = item.cubicIn ?? 0
    const box = boxes.find((b) => b.weightLb + item.weightLb <= rules.sharedBoxMaxLb && b.cubicIn + cubicIn <= rules.sharedBoxMaxCubicIn)
    if (box) {
      box.weightLb += item.weightLb
      box.cubicIn += cubicIn
      box.sized = box.sized && item.cubicIn != null
    } else {
      boxes.push({ weightLb: item.weightLb, cubicIn, sized: item.cubicIn != null })
    }
    if (parcels.length + boxes.length > rules.maxParcels) return { ok: false, error: 'This order is too large to ship by UPS. Please call us to arrange delivery.', lines: [], reason: 'too_many' }
  }
  for (const box of boxes) {
    if (!box.sized) {
      parcels.push({ weightLb: box.weightLb })
      continue
    }
    const side = Math.ceil(Math.cbrt(box.cubicIn * (1 + rules.packingAllowance)) - 1e-9)
    parcels.push({ weightLb: box.weightLb, lengthIn: side, widthIn: side, heightIn: side })
  }

  const rounded = parcels.map((parcel) => ({ ...parcel, weightLb: roundUp(parcel.weightLb, 1) }))
  return { ok: true, parcels: rounded, totalWeightLb: roundUp(rounded.reduce((sum, parcel) => sum + parcel.weightLb, 0), 1) }
}

// ---- asking UPS ------------------------------------------------------------

export interface UpsConfig {
  /** From the app made at developer.ups.com. */
  clientId: string
  clientSecret: string
  /** The store's 6-character UPS account ("shipper") number. */
  accountNumber: string
  /** https://onlinetools.ups.com (real rates) or https://wwwcie.ups.com (UPS's test system). */
  baseUrl: string
  /** Where parcels leave from, beyond the ZIP code. */
  shipFromState: string
  shipFromCity?: string | null
  /** The UPS services offered, by UPS's code. 03 = Ground. */
  serviceCodes: readonly string[]
  /** 'published' charges UPS's list rate; 'negotiated' charges the store's own discounted rate. */
  charge: 'published' | 'negotiated'
  timeoutMs?: number
  /** Stand-ins for tests. */
  fetch?: typeof fetch
  now?: () => number
}

export const UPS_PRODUCTION_URL = 'https://onlinetools.ups.com'
export const UPS_TEST_URL = 'https://wwwcie.ups.com'

/** UPS's names for its US services, by code. */
export const UPS_SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '59': 'UPS 2nd Day Air A.M.',
}

/** The UPS settings are missing from .env.local. */
export class UpsNotConfigured extends Error {
  constructor() {
    super('UPS rates are not set up: set UPS_CLIENT_ID, UPS_CLIENT_SECRET and UPS_ACCOUNT_NUMBER in .env.local.')
    this.name = 'UpsNotConfigured'
  }
}

/** Reads the UPS_… settings (see README). */
export function upsConfigFromEnv(env: Record<string, string | undefined> = process.env): UpsConfig {
  const value = (name: string) => env[name]?.trim() || ''
  const clientId = value('UPS_CLIENT_ID')
  const clientSecret = value('UPS_CLIENT_SECRET')
  const accountNumber = value('UPS_ACCOUNT_NUMBER')
  if (!clientId || !clientSecret || !accountNumber) throw new UpsNotConfigured()
  const serviceCodes = (value('UPS_SERVICES') || '03').split(',').map((code) => code.trim()).filter(Boolean)
  return {
    clientId,
    clientSecret,
    accountNumber,
    baseUrl: value('UPS_ENVIRONMENT').toLowerCase() === 'test' ? UPS_TEST_URL : UPS_PRODUCTION_URL,
    shipFromState: value('UPS_SHIP_FROM_STATE') || 'FL',
    shipFromCity: value('UPS_SHIP_FROM_CITY') || null,
    serviceCodes,
    charge: value('UPS_RATES').toLowerCase() === 'negotiated' ? 'negotiated' : 'published',
  }
}

export interface UpsAddress {
  street1?: string | null
  street2?: string | null
  city?: string | null
  /** Two letters: FL */
  state?: string | null
  zip: string
  /** Two letters; US when left out. */
  country?: string | null
  /** A home rather than a business. UPS charges more for homes; assumed true when not known. */
  residential?: boolean
}

export interface UpsQuoteRequest {
  /** The ZIP code parcels leave from. */
  fromZip: string
  toAddress: UpsAddress
  parcels: readonly Parcel[]
}

export interface UpsRate {
  /** UPS's code for the service: 03 = Ground. */
  serviceCode: string
  serviceName: string
  rateCents: number
  currency: string
}

export type UpsQuoteResult =
  | { ok: true; rates: UpsRate[] }
  | {
      ok: false
      /** Safe to show the customer. */
      error: string
      /** True when asking again a little later could work. */
      retryable: boolean
      /** For staff. Never contains the client secret or a token. */
      detail: string
    }

const ADDRESS_PROBLEM = 'UPS could not price delivery to this address. Please check the address, or choose warehouse pickup.'
const UPS_DOWN = 'We could not get a UPS rate just now. Please try again in a moment, or choose warehouse pickup.'

// One sign-in token per UPS app, kept until shortly before it runs out.
const tokens = new Map<string, { token: string; expiresAt: number }>()

/** Forgets any saved UPS sign-in. For tests. */
export function clearUpsTokens(): void {
  tokens.clear()
}

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asList = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [])
const child = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined)

/** "12.30" -> 1230; null when it isn't an amount. */
function moneyToCents(value: unknown): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(typeof value === 'string' ? value.trim() : typeof value === 'number' ? value.toFixed(2) : '')
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null
}

/** UPS's own words for what went wrong, from an error answer. */
function upsErrors(body: unknown): string {
  const errors = asList(child(child(body, 'response'), 'errors'))
  return errors.map((error) => `${String(error.code ?? '')} ${String(error.message ?? '')}`.trim()).join('; ').slice(0, 300)
}

interface Reply {
  status: number | null
  body: unknown
  failure: string | null
}

async function send(config: UpsConfig, path: string, init: { headers: Record<string, string>; body: string }): Promise<Reply> {
  const doFetch = config.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${config.baseUrl}${path}`, { method: 'POST', headers: init.headers, body: init.body, signal: AbortSignal.timeout(config.timeoutMs ?? 15_000) })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { status: null, body: null, failure: name === 'TimeoutError' || name === 'AbortError' ? 'UPS did not answer in time' : 'UPS could not be reached' }
  }
  let body: unknown = null
  try {
    body = JSON.parse(await response.text())
  } catch {
    body = null
  }
  return { status: response.status, body, failure: response.ok ? (body == null ? 'UPS’s answer could not be read' : null) : `UPS answered HTTP ${response.status}` }
}

async function signIn(config: UpsConfig): Promise<{ token: string } | { failure: string; retryable: boolean }> {
  const now = (config.now ?? Date.now)()
  const key = `${config.baseUrl}|${config.clientId}`
  const saved = tokens.get(key)
  if (saved && saved.expiresAt > now) return { token: saved.token }

  const reply = await send(config, '/security/v1/oauth/token', {
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'x-merchant-id': config.accountNumber,
    },
    body: 'grant_type=client_credentials',
  })
  const token = child(reply.body, 'access_token')
  if (reply.failure != null || typeof token !== 'string' || !token) {
    const refused = reply.status != null && reply.status >= 400 && reply.status < 500 && reply.status !== 429
    return { failure: `UPS sign-in failed: ${reply.failure ?? 'no token in the answer'}${upsErrors(reply.body) ? ` (${upsErrors(reply.body)})` : ''}`, retryable: !refused }
  }
  const seconds = Number(child(reply.body, 'expires_in'))
  // Kept until a minute before UPS says it runs out; a few minutes when UPS doesn't say.
  tokens.set(key, { token, expiresAt: now + (Number.isFinite(seconds) && seconds > 120 ? seconds - 60 : 240) * 1000 })
  return { token }
}

/** What UPS is sent to price a shipment. */
export function buildRateRequest(request: UpsQuoteRequest, config: Pick<UpsConfig, 'accountNumber' | 'shipFromState' | 'shipFromCity' | 'charge'>): Json {
  const from = {
    ...(config.shipFromCity ? { City: config.shipFromCity } : {}),
    StateProvinceCode: config.shipFromState,
    PostalCode: request.fromZip,
    CountryCode: 'US',
  }
  const to = request.toAddress
  const street = [to.street1, to.street2].map((line) => line?.trim()).filter((line): line is string => Boolean(line))
  return {
    RateRequest: {
      Request: { TransactionReference: { CustomerContext: 'checkout rate' } },
      Shipment: {
        Shipper: { ShipperNumber: config.accountNumber, Address: from },
        ShipFrom: { Address: from },
        ShipTo: {
          Address: {
            ...(street.length > 0 ? { AddressLine: street.map((line) => line.slice(0, 35)) } : {}),
            ...(to.city?.trim() ? { City: to.city.trim().slice(0, 30) } : {}),
            ...(to.state?.trim() ? { StateProvinceCode: to.state.trim().toUpperCase() } : {}),
            PostalCode: to.zip.trim(),
            CountryCode: (to.country?.trim() || 'US').toUpperCase(),
            // Present = a home. UPS reads the tag itself, whatever is in it.
            ...(to.residential === false ? {} : { ResidentialAddressIndicator: 'Y' }),
          },
        },
        PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: config.accountNumber } }] },
        ...(config.charge === 'negotiated' ? { ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' } } : {}),
        NumOfPieces: String(request.parcels.length),
        Package: request.parcels.map((parcel) => ({
          PackagingType: { Code: '02', Description: 'Package' },
          ...(positive(parcel.lengthIn) && positive(parcel.widthIn) && positive(parcel.heightIn)
            ? {
                Dimensions: {
                  UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
                  Length: String(roundUp(parcel.lengthIn, 0)),
                  Width: String(roundUp(parcel.widthIn, 0)),
                  Height: String(roundUp(parcel.heightIn, 0)),
                },
              }
            : {}),
          PackageWeight: { UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' }, Weight: roundUp(parcel.weightLb, 1).toFixed(1) },
        })),
      },
    },
  }
}

/** The rates in a UPS answer for the services we offer, cheapest first. */
export function readRates(body: unknown, config: Pick<UpsConfig, 'serviceCodes' | 'charge'>): UpsRate[] {
  const rates: UpsRate[] = []
  for (const shipment of asList(child(child(body, 'RateResponse'), 'RatedShipment'))) {
    const serviceCode = String(child(shipment.Service, 'Code') ?? '').trim()
    if (!config.serviceCodes.includes(serviceCode)) continue
    const negotiated = child(shipment.NegotiatedRateCharges, 'TotalCharge')
    // The store's own rate when asked for and given; otherwise UPS's list rate.
    const charges = config.charge === 'negotiated' && isRecord(negotiated) ? negotiated : shipment.TotalCharges
    const rateCents = moneyToCents(child(charges, 'MonetaryValue'))
    if (rateCents == null || rateCents <= 0) continue
    rates.push({ serviceCode, serviceName: UPS_SERVICE_NAMES[serviceCode] ?? `UPS service ${serviceCode}`, rateCents, currency: String(child(charges, 'CurrencyCode') ?? 'USD') })
  }
  return rates.sort((a, b) => a.rateCents - b.rateCents)
}

/** A random reference for one request, as UPS asks for (32 characters). */
function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Asks UPS what it costs to send these parcels from our ZIP code to the
 * customer's address. Returns the rates for the services we offer, or a
 * message for the customer when UPS can't price it.
 */
export async function quoteUps(request: UpsQuoteRequest, config: UpsConfig = upsConfigFromEnv()): Promise<UpsQuoteResult> {
  const refuse = (detail: string): UpsQuoteResult => ({ ok: false, error: ADDRESS_PROBLEM, retryable: false, detail })
  if (!/^\d{5}$/.test(request.fromZip)) return { ok: false, error: UPS_DOWN, retryable: false, detail: 'the ship-from ZIP code is not set' }
  if (!/^\d{5}(-?\d{4})?$/.test(request.toAddress.zip?.trim() ?? '')) return refuse('the delivery ZIP code is missing or malformed')
  if (request.parcels.length === 0 || request.parcels.some((parcel) => !positive(parcel.weightLb))) return refuse('there are no parcels to rate, or one has no weight')

  const body = JSON.stringify(buildRateRequest(request, config))
  // A sign-in that UPS no longer accepts is replaced once; asking for a rate is safe to repeat.
  for (let attempt = 1; ; attempt++) {
    const signedIn = await signIn(config)
    if ('failure' in signedIn) return { ok: false, error: UPS_DOWN, retryable: signedIn.retryable, detail: signedIn.failure }
    const reply = await send(config, '/api/rating/v2409/Shop', {
      headers: { Authorization: `Bearer ${signedIn.token}`, 'Content-Type': 'application/json', Accept: 'application/json', transId: requestId(), transactionSrc: 'website-checkout' },
      body,
    })
    if (reply.status === 401 && attempt === 1) {
      tokens.delete(`${config.baseUrl}|${config.clientId}`)
      continue
    }
    if (reply.failure != null) {
      const detail = `${reply.failure}${upsErrors(reply.body) ? `: ${upsErrors(reply.body)}` : ''}`
      // 400-range answers are UPS rejecting the address or the parcels; the rest are passing faults.
      const rejected = reply.status != null && reply.status >= 400 && reply.status < 500 && reply.status !== 401 && reply.status !== 403 && reply.status !== 429
      if (rejected) return { ok: false, error: ADDRESS_PROBLEM, retryable: false, detail }
      return { ok: false, error: UPS_DOWN, retryable: reply.status !== 401 && reply.status !== 403, detail }
    }
    const rates = readRates(reply.body, config)
    if (rates.length === 0) return { ok: false, error: ADDRESS_PROBLEM, retryable: false, detail: 'UPS answered, but with no rate for the services we offer' }
    return { ok: true, rates }
  }
}
