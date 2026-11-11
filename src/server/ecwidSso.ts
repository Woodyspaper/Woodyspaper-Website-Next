import { createHmac } from 'node:crypto'

/*
 * Lightspeed eCom (Ecwid) single sign-on payload.
 * Spec: https://docs.ecwid.com/api-reference/rest-api/storefront-widget-details/sso-single-sign-on-for-websites/add-sso-to-the-website
 *
 *   "<base64 JSON> <HMAC-SHA256 hex of 'base64 timestamp', keyed with client_secret> <unix timestamp>"
 *
 * Ecwid ties the store customer to (appClientId, userId). It cannot attach to
 * a store customer that already exists under the same email, which is why only
 * store accounts created through the website use this.
 */
export type SsoProfile = {
  clientId: string
  clientSecret: string
  /** The website account's id. */
  userId: number
  email: string
  name: string
  /** Unix seconds. Ecwid rejects payloads more than 10 minutes old. */
  now?: number
}

export function buildSsoPayload({ clientId, clientSecret, userId, email, name, now }: SsoProfile): string {
  const timestamp = Math.floor(now ?? Date.now() / 1000)
  const message = Buffer.from(
    JSON.stringify({
      appClientId: clientId,
      userId: String(userId),
      profile: { email, billingPerson: { name } },
    }),
    'utf8',
  ).toString('base64')
  const signature = createHmac('sha256', clientSecret).update(`${message} ${timestamp}`).digest('hex')
  return `${message} ${signature} ${timestamp}`
}
