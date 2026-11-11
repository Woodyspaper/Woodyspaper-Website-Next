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
  if (!originHost || !host || originHost !== host) throw new ApiError(403, 'Request not allowed.')
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
 * Best-effort visitor address, for throttling only. Behind the reverse proxy
 * it's the first X-Forwarded-For entry; a visitor could fake that header when
 * connecting directly, which only affects their own throttling bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || request.headers.get('x-real-ip') || 'unknown').slice(0, 100)
}
