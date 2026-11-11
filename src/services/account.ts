import { useSyncExternalStore } from 'react'
import { withRetry } from './retry'

/**
 * The visitor's Woody's Paper website account (name, email, password — stored
 * in our own database through the /api routes). This is separate from the
 * Lightspeed store's sign-in state in storeCustomer.ts; an account can be
 * linked to a store account from the /account page.
 */
export type Account = {
  name: string
  email: string
  emailVerified: boolean
  /** Their store account was created through the website, so the store signs them in automatically. */
  storeSso: boolean
}

export const LOGIN_PATH = '/login'
export const SIGNUP_PATH = '/signup'
export const ACCOUNT_PAGE = '/account'

/** undefined = not asked yet; null = signed out. */
let account: Account | null | undefined
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

/**
 * Remembers between visits that the store must start in single sign-on mode,
 * so the store only waits on the server for the few visitors who need it.
 */
const SSO_HINT_KEY = 'woodys-store-sso'

/**
 * Set when someone the website had signed in to the store signs out of the
 * website. The store keeps its own sign-in between visits, and it usually
 * isn't on the page where they sign out, so the next store load finishes the
 * job (LightSpeedStore.tsx).
 */
const STORE_SIGN_OUT_KEY = 'woodys-store-sign-out'

function writeFlag(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage blocked: the store just opens without automatic sign-in.
  }
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeSsoHint(on: boolean) {
  writeFlag(SSO_HINT_KEY, on)
  // Signed in again as a single sign-on customer: nothing left to sign out.
  if (on) writeFlag(STORE_SIGN_OUT_KEY, false)
}

/** True once if the store still has to be signed out after a website sign-out. */
export function takePendingStoreSignOut(): boolean {
  const pending = readFlag(STORE_SIGN_OUT_KEY)
  if (pending) writeFlag(STORE_SIGN_OUT_KEY, false)
  return pending
}

export function hasStoreSsoHint(): boolean {
  return readFlag(SSO_HINT_KEY)
}

function publish(next: Account | null) {
  account = next
  listeners.forEach((listener) => listener())
}

/**
 * Asks the server who is signed in. Call after signing in, out, or changing
 * the account. A failed request is tried again (see `api`).
 */
export function refreshAccount(): Promise<void> {
  loading = api<{ user: Account | null }>('/api/auth/me')
    .then((data) => {
      writeSsoHint(Boolean(data.user?.storeSso))
      publish(data.user ?? null)
    })
    // Still unreachable after the retries: show "Sign In" rather than an error
    // in the header. The pages that need the account say so themselves.
    .catch(() => publish(null))
  return loading
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (account === undefined && !loading) void refreshAccount()
  return () => {
    listeners.delete(listener)
  }
}

/** The signed-in account, null when signed out, undefined until the server has answered. */
export function useAccount(): Account | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => account,
    () => undefined,
  )
}

/** How long one try may take before it counts as failed. */
const API_TIMEOUT_MS = 15_000

const OFFLINE_MESSAGE = 'We couldn’t reach the server. Check your connection and try again.'
const TIMEOUT_MESSAGE = 'The server took too long to answer. Please try again in a moment.'

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...(body === undefined
        ? { cache: 'no-store' as const }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    // Status 0: the request never got an answer.
    const timedOut = (error as { name?: string } | null)?.name === 'TimeoutError'
    throw new ApiFailure(0, timedOut ? TIMEOUT_MESSAGE : OFFLINE_MESSAGE)
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !data) {
    throw new ApiFailure(response.status, data?.error ?? 'Something went wrong. Please try again.')
  }
  return data
}

/**
 * Calls one of the site's /api routes: GET without a body, POST with one.
 * Throws an ApiFailure whose message can be shown to the visitor.
 *
 * Reads (GET) that fail to connect, time out or hit a server error are tried
 * again, up to three tries in all (services/retry.ts). Actions (POST) are
 * never repeated automatically: "create my account" or "send me a code"
 * might have worked even though the answer was lost, so the visitor is told
 * and chooses whether to press the button again.
 */
export function api<T = { ok: true }>(path: string, body?: Record<string, unknown>): Promise<T> {
  if (body !== undefined) return request<T>(path, body)
  return withRetry(() => request<T>(path), {
    shouldRetry: (error) => error instanceof ApiFailure && (error.status === 0 || error.status === 429 || error.status >= 500),
  })
}

export class ApiFailure extends Error {
  /** HTTP status of the reply, or 0 when there was none (offline, timed out). */
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Signs out of the website (and the store, if the website signed them in there), then reloads. */
export async function signOut() {
  await api('/api/auth/logout', {}).catch(() => undefined)
  if (hasStoreSsoHint()) {
    // The website signed them in to the store, so it signs them out too. The
    // store remembers its sign-in on its own, and may not be on this page:
    // the flag makes the next store load sign out (see takePendingStoreSignOut).
    writeFlag(STORE_SIGN_OUT_KEY, true)
    try {
      window.Ecwid?.setSsoProfile?.('')
    } catch {
      // The store isn't on this page.
    }
  }
  writeSsoHint(false)
  // A full page load on purpose (not router.push), so nothing from the
  // signed-in session, the store's included, stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/')
}
