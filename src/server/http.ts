import 'server-only'
import { DatabaseNotConfigured } from './db'

/** An error whose message is safe to show the visitor. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE })
}

/**
 * Wraps a route handler: ApiErrors become `{ error }` responses, anything
 * else is logged and reported as a generic failure (no internals leak out).
 */
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request)
      return await handler(request)
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status)
      if (error instanceof DatabaseNotConfigured) {
        console.error(error.message)
        return json({ error: 'Accounts are not set up on this server yet.' }, 503)
      }
      console.error('API error', error)
      return json({ error: 'Something went wrong. Please try again.' }, 500)
    }
  }
}

/**
 * Cross-site request forgery check for requests that change something: the
 * browser's Origin header must be this site. (The session cookie is also
 * SameSite=Lax, so this is the second lock, not the only one.)
 *
 * "This site" is the address the request arrived at, or, when the pages are
 * hosted apart from the API, one of the addresses listed in SITE_ORIGINS
 * (.env.local, e.g. https://woodyspaper.com,https://www.woodyspaper.com).
 * next.config.ts gives the same addresses cross-origin access.
 */
function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let originHost: string | null = null
  try {
    originHost = origin ? new URL(origin).host : null
  } catch {
    originHost = null
  }
  if (originHost && host && originHost === host) return
  if (origin && siteOrigins().includes(origin)) return
  throw new ApiError(403, 'Request not allowed.')
}

function siteOrigins(): string[] {
  return (process.env.SITE_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/** The JSON body as an object. Anything else (or more than 10 KB) is a 400. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 10_000) throw new ApiError(400, 'Request too large.')
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // fall through
  }
  throw new ApiError(400, 'Invalid request.')
}

/** Unwraps a validation.ts result or throws its message as a 400. */
export function need(checked: { ok: true; value: string } | { ok: false; error: string }): string {
  if (!checked.ok) throw new ApiError(400, checked.error)
  return checked.value
}

/**
 * The visitor's address, for throttling only, or null when it can't be told.
 *
 * The site runs behind a reverse proxy or tunnel, and only that knows the
 * visitor's address; it passes it on in a request header. CLIENT_IP_HEADER
 * in .env.local names the header, e.g. `cf-connecting-ip` behind Cloudflare.
 * The default is X-Forwarded-For, of which the LAST entry is used: that is
 * the one the proxy itself added, while earlier entries are whatever the
 * visitor sent and can be faked.
 *
 * When the header is missing, Next.js fills X-Forwarded-For with the address
 * that connected to it. Behind a proxy or tunnel on this same machine that is
 * the machine itself (127.0.0.1), for every visitor alike. That says nothing
 * about who the visitor is, so it counts as not knowing.
 *
 * Null means the limits per address can't be applied; see ipBucket in
 * rateLimit.ts for what happens then.
 */
export function clientIp(request: Request): string | null {
  const header = (process.env.CLIENT_IP_HEADER || 'x-forwarded-for').trim().toLowerCase()
  const entries = (request.headers.get(header) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const address = header === 'x-forwarded-for' ? entries[entries.length - 1] : entries[0]
  if (!address || LOOPBACK.test(address)) return null
  return address.slice(0, 100)
}

/** This machine talking to itself: 127.x.x.x, ::1, and the IPv4-in-IPv6 form of the first. */
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i
