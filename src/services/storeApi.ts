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

/** GET https://app.ecwid.com/api/v3/{storeId}/{resource}. Rejects on a non-2xx reply. */
export async function storeApiGet<T>(resource: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://app.ecwid.com/api/v3/${STORE_ID}/${resource}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${PUBLIC_TOKEN}` },
    signal,
  })
  if (!response.ok) throw new Error(`Store API "${resource}" failed (${response.status})`)
  return (await response.json()) as T
}
