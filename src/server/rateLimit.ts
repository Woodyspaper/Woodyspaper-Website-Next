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

/** Throws a 429 once `max` attempts were recorded in the window; otherwise records this one. */
export async function limit(kind: string, key: string, max: number, minutes: number): Promise<void> {
  if ((await countAttempts(kind, key, minutes)) >= max) {
    throw new ApiError(429, 'Too many attempts. Please wait a while and try again.')
  }
  await recordAttempt(kind, key)
}
