import 'server-only'
import { query, sql } from './db'
import { ApiError } from './http'

/*
 * Throttling backed by the AuthAttempts table, so it holds across restarts.
 * `kind` names what is being limited; `key` is an email or IP address.
 */

export async function countAttempts(kind: string, key: string, minutes: number): Promise<number> {
  const result = await (await query())
    .input('kind', sql.VarChar(20), kind)
    .input('key', sql.NVarChar(300), key)
    .input('minutes', sql.Int, minutes)
    .query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM dbo.AuthAttempts
       WHERE Kind = @kind AND AttemptKey = @key AND At > DATEADD(MINUTE, -@minutes, SYSUTCDATETIME())`,
    )
  return result.recordset[0].n
}

export async function recordAttempt(kind: string, key: string): Promise<void> {
  await (await query())
    .input('kind', sql.VarChar(20), kind)
    .input('key', sql.NVarChar(300), key)
    .query(
      // Old rows are cleared as new ones arrive, so the table stays small.
      `INSERT INTO dbo.AuthAttempts (Kind, AttemptKey) VALUES (@kind, @key);
       DELETE FROM dbo.AuthAttempts WHERE At < DATEADD(DAY, -2, SYSUTCDATETIME());`,
    )
}

/**
 * The bucket and ceiling for a limit that is counted per visitor address.
 *
 * With a known address, each address gets its own bucket. With none (the
 * proxy isn't passing it on, see clientIp in http.ts) every visitor would
 * share one bucket, and a handful of people mistyping a password could lock
 * the whole site out. So the shared bucket gets a ceiling 20 times higher:
 * still a brake on a flood, never a lock on ordinary use. The limits per
 * email address and per account are unaffected and remain the real guard.
 */
export function ipBucket(ip: string | null, max: number): { key: string; max: number } {
  return ip ? { key: ip, max } : { key: 'unknown', max: max * 20 }
}

/** `limit`, counted per visitor address (see ipBucket). */
export async function limitByIp(kind: string, ip: string | null, max: number, minutes: number): Promise<void> {
  const bucket = ipBucket(ip, max)
  await limit(kind, bucket.key, bucket.max, minutes)
}

/** Throws a 429 once `max` attempts were recorded in the window; otherwise records this one. */
export async function limit(kind: string, key: string, max: number, minutes: number): Promise<void> {
  if ((await countAttempts(kind, key, minutes)) >= max) {
    throw new ApiError(429, 'Too many attempts. Please wait a while and try again.')
  }
  await recordAttempt(kind, key)
}
