import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/*
 * Session tokens and emailed one-time codes. Only hashes are stored in the
 * database, so a copy of the database can't be used to sign in as anyone.
 */

/** A new session token for the cookie, and the hash to store for it. */
export function newSessionToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashSessionToken(token) }
}

/** Session tokens are long and random, so a plain SHA-256 is enough. */
export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export const CODE_LENGTH = 6

/** A 6-digit code, leading zeros kept. */
export function newCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0')
}

/**
 * Codes are short, so their hash is keyed with the server's secret: without
 * it, a stolen database row can't be reversed by trying all million codes.
 * The purpose and user are mixed in so a code only works where it was issued.
 */
export function hashCode(code: string, purpose: string, userId: number, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}:${userId}:${code.trim()}`).digest()
}

export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}
