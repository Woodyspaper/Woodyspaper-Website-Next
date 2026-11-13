// Read-only clients for the two Lightspeed APIs, used by the importer.
// Both refuse anything but GET, wait between calls and back off when told to.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url, token, label) {
  for (let attempt = 1; ; attempt++) {
    await sleep(250)
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      if (attempt >= 4) throw new Error(`${label}: ${error?.message ?? error}`)
      await sleep(1500 * attempt)
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const header = response.headers.get('retry-after')
      const seconds = Number(header)
      const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 3000 * attempt
      await sleep(Math.min(Math.max(wait || 3000, 1000), 120_000))
      continue
    }
    if (!response.ok) throw new Error(`${label} answered HTTP ${response.status}`)
    return response.json()
  }
}

/** Every item of a Lightspeed eCom (Ecwid) list endpoint. */
export async function ecomAll(resource) {
  const storeId = process.env.NEXT_PUBLIC_LIGHTSPEED_STORE_ID
  const token = process.env.LIGHTSPEED_SECRET_TOKEN
  if (!storeId || !token) throw new Error('Set NEXT_PUBLIC_LIGHTSPEED_STORE_ID and LIGHTSPEED_SECRET_TOKEN in .env.local.')
  const items = []
  for (let offset = 0; ; offset += 100) {
    const body = await getJson(`https://app.ecwid.com/api/v3/${storeId}/${resource}?offset=${offset}&limit=100`, token, `eCom ${resource}`)
    if (Array.isArray(body)) return body
    const page = body.items ?? []
    items.push(...page)
    if (page.length < 100 || (body.total != null && items.length >= body.total)) return items
  }
}

/** Every row of a Lightspeed Retail (X-Series) API 2.0 collection, deleted rows included. */
export async function retailAll(resource) {
  const prefix = process.env.LIGHTSPEED_DOMAIN_PREFIX
  const token = process.env.LIGHTSPEED_ACCESS_TOKEN
  if (!prefix || !token) throw new Error('Set LIGHTSPEED_DOMAIN_PREFIX and LIGHTSPEED_ACCESS_TOKEN in .env.local.')
  if (!/^[a-z0-9-]+$/i.test(prefix)) throw new Error('LIGHTSPEED_DOMAIN_PREFIX must be just the store subdomain.')
  const items = []
  for (let after = 0; ; ) {
    const body = await getJson(`https://${prefix}.retail.lightspeed.app/api/2.0/${resource}?after=${after}&page_size=1000`, token, `Retail ${resource}`)
    const page = body.data ?? []
    if (!Array.isArray(page) || page.length === 0) return items
    items.push(...page)
    const max = body.version?.max
    if (max == null || max === after) return items
    after = max
  }
}
