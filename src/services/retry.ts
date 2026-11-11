/*
 * Retrying requests that fail for passing reasons: a dropped connection, a
 * timeout, a server that is briefly overloaded. Used by every read the site
 * makes, in the browser (storeApi.ts, account.ts) and on the server
 * (server/lightspeed.ts). No imports, so both sides and the tests can use it.
 *
 * Only retry requests that are safe to repeat. Reading is; "send this code",
 * "create this account" or "email this inquiry" are not, because the first
 * try may have worked even though its answer never arrived.
 */

/** A reply that came back, but with an error status. */
export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Waits before the 2nd and 3rd tries. Short, so a blip costs the visitor about a second. */
export const RETRY_DELAYS_MS = [400, 1200]

/**
 * Worth another try? Yes for a failed connection, a timeout, "too many
 * requests" and server-side errors. No for anything the request itself got
 * wrong (400, 401, 403, 404…): asking again gives the same answer. Never for
 * a request the caller cancelled.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 408 || error.status === 429 || error.status >= 500
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'AbortError') return false
  if (name === 'TimeoutError') return true
  // fetch() rejects with a TypeError when the network fails.
  return error instanceof TypeError
}

type RetryOptions = {
  /** Waits between tries, in ms; its length is the number of retries. */
  delays?: number[]
  /** Cancels the waiting (and should be passed to the request itself too). */
  signal?: AbortSignal
  shouldRetry?: (error: unknown) => boolean
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Runs `request`, and runs it again after a short wait if it fails in a way
 * that might pass. Resolves with the first success; rejects with the last
 * error once the tries are used up, or at once for an error not worth
 * retrying.
 */
export async function withRetry<T>(request: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS
  const shouldRetry = options.shouldRetry ?? isRetryable
  for (let attempt = 0; ; attempt++) {
    try {
      return await request()
    } catch (error) {
      if (attempt >= delays.length || options.signal?.aborted || !shouldRetry(error)) throw error
      await wait(delays[attempt], options.signal)
    }
  }
}
