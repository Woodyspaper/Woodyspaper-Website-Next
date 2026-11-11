import { HttpError, withRetry } from './retry'

/**
 * Read-only calls to Lightspeed's (Ecwid) REST API from the browser.
 *
 * Uses the store's PUBLIC token, a read-only key made for storefronts, which is
 * safe to ship in the site. Never put the secret token here. Without a public
 * token, the features built on this (search suggestions, the category bar's
 * category list) switch off quietly.
 */

const STORE_ID = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID
/**
 * NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN in .env.local. Anything that isn't a
 * "public_" token (e.g. a secret pasted by mistake) is ignored instead of used.
 */
const rawToken = process.env.NEXT_PUBLIC_LIGHTSPEED_PUBLIC_TOKEN?.trim() ?? ''
const PUBLIC_TOKEN = rawToken.startsWith('public_') ? rawToken : ''

export const storeApiEnabled = Boolean(STORE_ID && PUBLIC_TOKEN)

/** How long one try may take before it counts as failed. */
const TIMEOUT_MS = 10_000

/**
 * GET https://app.ecwid.com/api/v3/{storeId}/{resource}.
 *
 * A dropped connection, a timeout or a busy store is tried again, up to three
 * tries in all (services/retry.ts). Rejects with the last error after that,
 * straight away on a reply that asking again won't change (a 4xx), and with
 * an AbortError when `signal` is aborted.
 */
export function storeApiGet<T>(resource: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = `https://app.ecwid.com/api/v3/${STORE_ID}/${resource}?${new URLSearchParams(params)}`
  return withRetry(
    async () => {
      const timeout = AbortSignal.timeout(TIMEOUT_MS)
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${PUBLIC_TOKEN}` },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      if (!response.ok) throw new HttpError(response.status, `Store API "${resource}" failed (${response.status})`)
      return (await response.json()) as T
    },
    { signal },
  )
}
