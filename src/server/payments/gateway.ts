/*
 * The card payment gateway (pmtboxgw, which runs on NMI's platform).
 *
 * The customer types their card into the gateway's own fields in the
 * browser (Collect.js). Those fields hand our page a single-use "payment
 * token"; the card number, expiry date and security code never reach this
 * server. This file takes that token and asks the gateway to charge it.
 *
 *   chargeToken        charge a token for an order (a "sale")
 *   voidTransaction    cancel a charge before it has settled (same day)
 *   refundTransaction  give money back on a settled charge
 *   lookupCharge       ask the gateway what it holds for an order number
 *
 * NEVER CHARGED TWICE BLINDLY. If the gateway's answer to a charge is lost
 * (a time-out, a dropped connection, a garbled reply), the charge may or may
 * not have gone through. chargeToken then does NOT try again. It asks the
 * gateway's Query API for transactions carrying our order number and reports
 * what it finds: approved, declined, or "not known" for staff to check.
 *
 * Documented at the gateway's integration portal (Payment API, Query API):
 * https://secure.pmtboxgw.com/merchants/resources/integration/integration_portal.php
 *
 * Nothing here writes to the log, and the token and the security key are
 * stripped from every message this file returns.
 *
 * Kept free of imports so the tests can run it with a stand-in for `fetch`.
 * Every function takes the gateway settings as its last argument; left out,
 * they are read from .env.local (PAYMENT_GATEWAY_URL, PAYMENT_SECURITY_KEY).
 */

export interface GatewayConfig {
  /** The gateway's address, e.g. https://secure.pmtboxgw.com */
  url: string
  /** The private API key (merchant control panel -> Settings -> Security Keys). Server only. */
  securityKey: string
  /** How long to wait for an answer to a charge, in milliseconds. */
  timeoutMs?: number
  /** Waits before each look-up after a lost answer, in milliseconds. */
  lookupDelaysMs?: readonly number[]
  /** Stand-in for fetch, for tests. */
  fetch?: typeof fetch
}

export const DEFAULT_GATEWAY_URL = 'https://secure.pmtboxgw.com'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_LOOKUP_DELAYS_MS = [2_000, 5_000]
const LOOKUP_TIMEOUT_MS = 20_000

/** The gateway keys are missing from .env.local. */
export class GatewayNotConfigured extends Error {
  constructor() {
    super('Card payments are not set up: set PAYMENT_SECURITY_KEY in .env.local.')
    this.name = 'GatewayNotConfigured'
  }
}

/** Reads PAYMENT_GATEWAY_URL and PAYMENT_SECURITY_KEY (see README). */
export function gatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const securityKey = env.PAYMENT_SECURITY_KEY?.trim()
  if (!securityKey) throw new GatewayNotConfigured()
  const url = (env.PAYMENT_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL).replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('PAYMENT_GATEWAY_URL must be an https address with nothing after the host name.')
  return { url, securityKey }
}

export interface BillingDetails {
  firstName?: string
  lastName?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  /** Two letters: FL */
  state?: string
  zip?: string
  /** Two letters: US */
  country?: string
  phone?: string
  email?: string
}

export interface ChargeRequest {
  /** The single-use payment token from Collect.js. */
  token: string
  /** What to charge, in cents. */
  amountCents: number
  /** Our order number. The gateway stores it, and it is how a lost answer is found again. */
  orderNumber: string
  billing?: BillingDetails
  /** The customer's address on the internet, for the gateway's fraud checks. */
  ip?: string | null
  /** The sales tax and delivery parts of the amount, in cents, for the gateway's records. */
  taxCents?: number
  shippingCents?: number
}

export interface ChargeApproved {
  status: 'approved'
  transactionId: string
  authCode: string
  /** The gateway's result code; 100 = approved. */
  responseCode: string
  responseText: string
  /** Address and security-code check result codes, when the gateway gave them. */
  avsResult: string | null
  cvvResult: string | null
  /** True when the first answer was lost and the approval was found by looking the order up. */
  recovered: boolean
}

export interface ChargeDeclined {
  status: 'declined'
  /** Safe to show the customer. */
  message: string
  responseCode: string
  responseText: string
  transactionId: string | null
}

export interface ChargeError {
  status: 'error'
  /** Safe to show the customer. */
  message: string
  /**
   * 'no'      the gateway said plainly that nothing was charged
   * 'unknown' no clear answer, even after looking the order up. Do not charge
   *           again; mark the order for staff to check in the gateway.
   */
  charged: 'no' | 'unknown'
  /** True when the same request could reasonably work a little later. */
  retryable: boolean
  responseCode: string | null
  /** For staff and the order history. Never contains the token or the key. */
  detail: string
}

export type ChargeResult = ChargeApproved | ChargeDeclined | ChargeError

/** What the gateway holds for an order number. */
export type ChargeLookup =
  | { found: 'approved'; transactionId: string; authCode: string; amountCents: number | null; avsResult: string | null; cvvResult: string | null }
  | { found: 'failed'; transactionId: string; responseCode: string | null; responseText: string }
  | { found: 'voided'; transactionId: string }
  | { found: 'none' }
  | { found: 'unknown'; detail: string }

export type GatewayActionResult =
  | { ok: true; transactionId: string; responseText: string }
  | {
      ok: false
      /** For staff. */
      message: string
      /** False when the answer was lost: check the gateway before trying again. */
      outcomeKnown: boolean
      responseCode: string | null
    }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 12345 -> "123.45" */
export function centsToAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** "123.45" -> 12345; null when it isn't an amount. */
function amountToCents(text: string | null): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?\d*$/.exec(text?.trim() ?? '')
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null
}

/** Takes the token and key out of any text before it leaves this file. */
function scrub(text: string, secrets: readonly string[]): string {
  let clean = text
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('[hidden]')
  return clean.slice(0, 300)
}

/**
 * What to tell the customer for each of the gateway's decline codes (the
 * "Result Code Table" in its documentation). Lost, stolen and fraud codes
 * get the same plain message as any other decline, on purpose.
 */
export function declineMessage(responseCode: string): string {
  switch (responseCode) {
    case '202':
      return 'The card was declined for insufficient funds. Please try another card.'
    case '203':
      return 'The card was declined because it is over its limit. Please try another card.'
    case '220':
    case '221':
    case '222':
      return 'The card details were not accepted. Please check the card number and try again.'
    case '223':
      return 'The card has expired. Please try another card.'
    case '224':
      return 'The expiry date was not accepted. Please check it and try again.'
    case '225':
      return 'The security code was not accepted. Please check the 3 or 4 digit code and try again.'
    case '240':
      return 'The card was declined. Please call your bank, or try another card.'
    case '264':
      return 'The card was declined for now. Please try another card.'
    default:
      return 'The card was declined. Please try another card, or call your bank.'
  }
}

const NOT_CHARGED = 'We could not take the payment, and your card was not charged. Please try again in a moment.'
const NOT_KNOWN =
  'We could not confirm the payment. Please do not try again: we will check with the card processor and email you shortly. If you would rather not wait, call us.'

interface Posted {
  /** The reply's fields, when one came back and could be read. */
  fields: URLSearchParams | null
  body: string | null
  httpStatus: number | null
  /** Why there is no usable reply. */
  failure: string | null
  /** True when the request certainly never left this machine. */
  neverSent: boolean
}

/** Error codes that mean the connection was never made, so nothing was sent. */
const NEVER_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])

async function post(config: GatewayConfig, path: string, form: Record<string, string>, timeoutMs: number): Promise<Posted> {
  const doFetch = config.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${config.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    return {
      fields: null,
      body: null,
      httpStatus: null,
      failure: timedOut ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : `could not reach the gateway${typeof code === 'string' ? ` (${code})` : ''}`,
      neverSent: typeof code === 'string' && NEVER_SENT.has(code),
    }
  }
  let body: string
  try {
    body = await response.text()
  } catch {
    return { fields: null, body: null, httpStatus: response.status, failure: 'the answer was cut off', neverSent: false }
  }
  if (!response.ok) return { fields: null, body, httpStatus: response.status, failure: `the gateway answered HTTP ${response.status}`, neverSent: false }
  return { fields: new URLSearchParams(body), body, httpStatus: response.status, failure: null, neverSent: false }
}

/** The text between <tag> and </tag>, with XML escapes undone; null when absent. */
function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) return null
  return match[1]
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
}

const xmlBlocks = (xml: string, tag: string): string[] => xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) ?? []

/**
 * Reads a Query API answer (XML) for one order number. An approved sale
 * wins over anything else; then a voided one; then a failed one.
 */
export function readLookup(xml: string, orderNumber: string): ChargeLookup {
  if (!/<nm_response>/.test(xml)) return { found: 'unknown', detail: 'the look-up answer was not understood' }
  const error = xmlValue(xml, 'error_response')
  if (error != null) return { found: 'unknown', detail: `the look-up was refused: ${error.slice(0, 200)}` }

  let failed: ChargeLookup | null = null
  let voided: ChargeLookup | null = null
  for (const transaction of xmlBlocks(xml, 'transaction')) {
    if (xmlValue(transaction, 'order_id') !== orderNumber) continue
    const transactionId = xmlValue(transaction, 'transaction_id') ?? ''
    const condition = xmlValue(transaction, 'condition') ?? ''
    const sale = xmlBlocks(transaction, 'action').find((action) => xmlValue(action, 'action_type') === 'sale')
    if (!sale || !transactionId) continue
    const succeeded = xmlValue(sale, 'success') === '1'
    if (succeeded && (condition === 'pendingsettlement' || condition === 'complete')) {
      return {
        found: 'approved',
        transactionId,
        authCode: xmlValue(transaction, 'authorization_code') ?? '',
        amountCents: amountToCents(xmlValue(sale, 'amount')),
        avsResult: xmlValue(transaction, 'avs_response') || null,
        cvvResult: xmlValue(transaction, 'csc_response') || null,
      }
    }
    if (succeeded && condition === 'canceled') voided = { found: 'voided', transactionId }
    else if (!succeeded || condition === 'failed') {
      failed = { found: 'failed', transactionId, responseCode: xmlValue(sale, 'response_code') || null, responseText: xmlValue(sale, 'response_text') ?? '' }
    } else {
      // A sale in a state we don't recognise: not safe to call it either way.
      return { found: 'unknown', detail: `transaction ${transactionId} is in state "${condition}"` }
    }
  }
  return voided ?? failed ?? { found: 'none' }
}

/** Asks the gateway what it holds for an order number. Reads only; safe to repeat. */
export async function lookupCharge(orderNumber: string, config: GatewayConfig = gatewayConfigFromEnv()): Promise<ChargeLookup> {
  const reply = await post(config, '/api/query.php', { security_key: config.securityKey, order_id: orderNumber }, LOOKUP_TIMEOUT_MS)
  if (reply.failure != null || reply.body == null) return { found: 'unknown', detail: `look-up failed: ${reply.failure ?? 'no answer'}` }
  const result = readLookup(reply.body, orderNumber)
  return result.found === 'unknown' ? { found: 'unknown', detail: scrub(result.detail, [config.securityKey]) } : result
}

/** Looks the order up after a lost answer, waiting a little first so a charge still in flight can land. */
async function resolveLostCharge(config: GatewayConfig, request: ChargeRequest, why: string): Promise<ChargeResult> {
  const secrets = [request.token, config.securityKey]
  const delays = config.lookupDelaysMs ?? DEFAULT_LOOKUP_DELAYS_MS
  let last: ChargeLookup = { found: 'unknown', detail: 'no look-up was made' }
  for (const delay of delays.length > 0 ? delays : [0]) {
    if (delay > 0) await sleep(delay)
    last = await lookupCharge(request.orderNumber, config)
    if (last.found === 'approved') {
      if (last.amountCents != null && last.amountCents !== request.amountCents) {
        return {
          status: 'error',
          message: NOT_KNOWN,
          charged: 'unknown',
          retryable: false,
          responseCode: null,
          detail: scrub(`${why}; the gateway holds an approved charge ${last.transactionId} for this order but for ${centsToAmount(last.amountCents)}, not ${centsToAmount(request.amountCents)}`, secrets),
        }
      }
      return {
        status: 'approved',
        transactionId: last.transactionId,
        authCode: last.authCode,
        responseCode: '100',
        responseText: 'Approved (found by looking the order up after a lost answer)',
        avsResult: last.avsResult,
        cvvResult: last.cvvResult,
        recovered: true,
      }
    }
    if (last.found === 'failed') {
      const code = last.responseCode ?? ''
      // 2xx codes are the bank saying no; anything else is a processing failure.
      if (/^2\d\d$/.test(code)) return { status: 'declined', message: declineMessage(code), responseCode: code, responseText: scrub(last.responseText, secrets), transactionId: last.transactionId }
      return { status: 'error', message: NOT_CHARGED, charged: 'no', retryable: true, responseCode: last.responseCode, detail: scrub(`${why}; the gateway recorded a failed attempt ${last.transactionId}: ${last.responseText}`, secrets) }
    }
    if (last.found === 'voided') {
      return { status: 'error', message: NOT_CHARGED, charged: 'no', retryable: false, responseCode: null, detail: scrub(`${why}; the gateway holds charge ${last.transactionId} for this order, already voided`, secrets) }
    }
  }
  const lookedUp = last.found === 'none' ? 'the gateway has no transaction for this order number yet' : last.found === 'unknown' ? last.detail : ''
  return { status: 'error', message: NOT_KNOWN, charged: 'unknown', retryable: false, responseCode: null, detail: scrub(`${why}; ${lookedUp}`, secrets) }
}

/**
 * Charges a payment token for an order. Returns approved, declined (with a
 * message for the customer) or error. It never throws for a payment
 * problem, and it never sends the charge a second time.
 */
export async function chargeToken(request: ChargeRequest, config: GatewayConfig = gatewayConfigFromEnv()): Promise<ChargeResult> {
  const secrets = [request.token, config.securityKey]
  const refuse = (detail: string): ChargeError => ({ status: 'error', message: NOT_CHARGED, charged: 'no', retryable: false, responseCode: null, detail })
  if (!request.token || !/^[\w-]{8,200}$/.test(request.token)) return refuse('the payment token was missing or malformed')
  if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) return refuse('the amount to charge was not a positive number of cents')
  if (!/^[\w-]{1,40}$/.test(request.orderNumber)) return refuse('the order number was missing or malformed')

  const form: Record<string, string> = {
    type: 'sale',
    security_key: config.securityKey,
    payment_token: request.token,
    amount: centsToAmount(request.amountCents),
    orderid: request.orderNumber,
    order_description: `Website order ${request.orderNumber}`,
  }
  const optional: Record<string, string | undefined> = {
    first_name: request.billing?.firstName,
    last_name: request.billing?.lastName,
    company: request.billing?.company,
    address1: request.billing?.address1,
    address2: request.billing?.address2,
    city: request.billing?.city,
    state: request.billing?.state,
    zip: request.billing?.zip,
    country: request.billing?.country,
    phone: request.billing?.phone,
    email: request.billing?.email,
    // The gateway documents this field as four numbers with dots, so other forms are left out.
    ipaddress: request.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(request.ip) ? request.ip : undefined,
    tax: request.taxCents != null && request.taxCents >= 0 ? centsToAmount(request.taxCents) : undefined,
    shipping: request.shippingCents != null && request.shippingCents >= 0 ? centsToAmount(request.shippingCents) : undefined,
  }
  for (const [name, value] of Object.entries(optional)) {
    const text = value?.trim()
    if (text) form[name] = text.slice(0, 200)
  }

  const reply = await post(config, '/api/transact.php', form, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  if (reply.neverSent) return { status: 'error', message: NOT_CHARGED, charged: 'no', retryable: true, responseCode: null, detail: reply.failure ?? 'could not reach the gateway' }
  // "Too many requests" is the gateway turning the request away before processing it.
  if (reply.httpStatus === 429) return { status: 'error', message: NOT_CHARGED, charged: 'no', retryable: true, responseCode: null, detail: 'the gateway is limiting requests (HTTP 429)' }
  if (reply.fields == null) return resolveLostCharge(config, request, `the charge got no usable answer (${reply.failure ?? 'unknown reason'})`)

  const field = (name: string) => reply.fields?.get(name)?.trim() ?? ''
  const outcome = field('response')
  const responseCode = field('response_code')
  const responseText = scrub(field('responsetext'), secrets)
  const transactionId = field('transactionid') === '0' ? '' : field('transactionid')

  if (outcome === '1') {
    // Approved, but without a transaction number we could not void, refund or prove it.
    if (!transactionId) return resolveLostCharge(config, request, 'the gateway said approved but gave no transaction number')
    return {
      status: 'approved',
      transactionId,
      authCode: field('authcode'),
      responseCode: responseCode || '100',
      responseText,
      avsResult: field('avsresponse') || null,
      cvvResult: field('cvvresponse') || null,
      recovered: false,
    }
  }
  if (outcome === '2') {
    return { status: 'declined', message: declineMessage(responseCode), responseCode, responseText, transactionId: transactionId || null }
  }
  if (outcome === '3') {
    // "Duplicate transaction": the gateway already holds this charge, most likely from a first try whose answer was lost.
    if (/duplicate/i.test(responseText) || responseCode === '430') return resolveLostCharge(config, request, `the gateway reported a duplicate (${responseText})`)
    // 301 = rate limit, 420 / 421 = communication errors: worth another go later. Others are set-up or data faults.
    const retryable = responseCode === '301' || responseCode === '420' || responseCode === '421'
    return { status: 'error', message: NOT_CHARGED, charged: 'no', retryable, responseCode: responseCode || null, detail: `gateway error ${responseCode}: ${responseText}` }
  }
  return resolveLostCharge(config, request, 'the gateway’s answer was not in the expected form')
}

async function simpleAction(config: GatewayConfig, form: Record<string, string>, what: string): Promise<GatewayActionResult> {
  const reply = await post(config, '/api/transact.php', { ...form, security_key: config.securityKey }, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (reply.fields == null) {
    const outcomeKnown = reply.neverSent || reply.httpStatus === 429
    return { ok: false, message: `The ${what} got no usable answer (${reply.failure ?? 'unknown reason'}).${outcomeKnown ? '' : ' Check the gateway before trying again.'}`, outcomeKnown, responseCode: null }
  }
  const responseCode = reply.fields.get('response_code')?.trim() || null
  const responseText = scrub(reply.fields.get('responsetext')?.trim() ?? '', [config.securityKey])
  const transactionId = reply.fields.get('transactionid')?.trim() ?? ''
  const outcome = reply.fields.get('response')?.trim()
  if (outcome === '1') return { ok: true, transactionId, responseText }
  if (outcome === '2' || outcome === '3') return { ok: false, message: `The ${what} was refused: ${responseText || `code ${responseCode}`}`, outcomeKnown: true, responseCode }
  return { ok: false, message: `The ${what} got an answer that was not understood. Check the gateway before trying again.`, outcomeKnown: false, responseCode }
}

/**
 * Cancels a charge that has not settled yet (normally the same day). The
 * customer's card is released without a charge and a refund showing.
 */
export function voidTransaction(transactionId: string, config: GatewayConfig = gatewayConfigFromEnv()): Promise<GatewayActionResult> {
  if (!/^\d{1,40}$/.test(transactionId)) return Promise.resolve({ ok: false, message: 'The transaction number is missing or malformed.', outcomeKnown: true, responseCode: null })
  return simpleAction(config, { type: 'void', transactionid: transactionId }, 'void')
}

/**
 * Gives money back on a settled charge: the amount given, which may be
 * less than the charge. A lost answer is NOT retried here, because a second
 * refund would pay the customer twice.
 */
export function refundTransaction(transactionId: string, amountCents: number, config: GatewayConfig = gatewayConfigFromEnv()): Promise<GatewayActionResult> {
  if (!/^\d{1,40}$/.test(transactionId)) return Promise.resolve({ ok: false, message: 'The transaction number is missing or malformed.', outcomeKnown: true, responseCode: null })
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return Promise.resolve({ ok: false, message: 'The refund amount must be more than zero.', outcomeKnown: true, responseCode: null })
  return simpleAction(config, { type: 'refund', transactionid: transactionId, amount: centsToAmount(amountCents) }, 'refund')
}
