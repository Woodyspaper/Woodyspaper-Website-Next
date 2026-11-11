import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/*
 * Password hashing with scrypt (built into Node, so no native add-on to build
 * on the server). Parameters follow OWASP's scrypt guidance: N=2^15, r=8, p=3.
 * They are stored with each hash, so they can be raised later without
 * breaking existing passwords.
 *
 * Stored format: scrypt$N$r$p$<salt base64>$<hash base64>
 */
const N = 2 ** 15
const R = 8
const P = 3
const KEY_LENGTH = 32
/** scrypt needs 128 * N * r bytes; Node's default cap is lower than that. */
const MAX_MEMORY = 128 * 1024 * 1024

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P, KEY_LENGTH)
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

/** False for a wrong password and for any stored value that isn't a valid hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const cost = [Number(n), Number(r), Number(p)]
  // Refuse absurd parameters rather than let a corrupt row tie up the server.
  if (!cost.every((value) => Number.isInteger(value) && value > 0) || cost[0] > 2 ** 20) return false
  const expected = Buffer.from(hash, 'base64')
  if (expected.length === 0) return false
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64'), cost[0], cost[1], cost[2], expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * A real hash of a throwaway password. Sign-in checks it when the email is
 * unknown, so "no such account" takes as long as "wrong password".
 */
let decoy: Promise<string> | undefined
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(16).toString('hex'))
  return decoy
}
