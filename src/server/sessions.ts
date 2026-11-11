import 'server-only'
import { cookies } from 'next/headers'
import { query, sql } from './db'
import { ApiError } from './http'
import { hashSessionToken, newSessionToken } from './tokens'

/*
 * Sign-in sessions. The browser holds a random token in an HttpOnly cookie
 * (scripts on the page can't read it); the database holds only its hash.
 */
const COOKIE = 'woodys_session'
const SESSION_DAYS = 30

export type SessionUser = {
  id: number
  name: string
  email: string
  emailVerified: boolean
}

export async function startSession(userId: number): Promise<void> {
  const { token, hash } = newSessionToken()
  await (await query())
    .input('hash', sql.VarBinary(32), hash)
    .input('userId', sql.Int, userId)
    .input('days', sql.Int, SESSION_DAYS)
    .query(
      `INSERT INTO dbo.Sessions (TokenHash, UserId, ExpiresAt)
       VALUES (@hash, @userId, DATEADD(DAY, @days, SYSUTCDATETIME()));
       DELETE FROM dbo.Sessions WHERE ExpiresAt < SYSUTCDATETIME();`,
    )
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    // Dev runs on plain http://localhost; production is always behind HTTPS.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

/** The signed-in account, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const result = await (await query())
    .input('hash', sql.VarBinary(32), hashSessionToken(token))
    .query<{ Id: number; Name: string; Email: string; EmailVerifiedAt: Date | null }>(
      `SELECT u.Id, u.Name, u.Email, u.EmailVerifiedAt
       FROM dbo.Sessions s JOIN dbo.Users u ON u.Id = s.UserId
       WHERE s.TokenHash = @hash AND s.ExpiresAt > SYSUTCDATETIME()`,
    )
  const row = result.recordset[0]
  if (!row) return null
  return { id: row.Id, name: row.Name, email: row.Email, emailVerified: row.EmailVerifiedAt !== null }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new ApiError(401, 'Please sign in.')
  return user
}

export async function requireVerifiedUser(): Promise<SessionUser> {
  const user = await requireUser()
  if (!user.emailVerified) throw new ApiError(403, 'Confirm your email address first.')
  return user
}

/**
 * Signs the account out everywhere except this browser. Used after a
 * password change: anyone else who was signed in has to sign in again with
 * the new password.
 */
export async function endOtherSessions(userId: number): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value
  await (await query())
    .input('userId', sql.Int, userId)
    // No cookie (shouldn't happen for a signed-in request): a hash nothing matches, so all are ended.
    .input('hash', sql.VarBinary(32), token ? hashSessionToken(token) : Buffer.alloc(32))
    .query('DELETE FROM dbo.Sessions WHERE UserId = @userId AND TokenHash <> @hash')
}

/** Signs this browser out. */
export async function endSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (token) {
    await (await query())
      .input('hash', sql.VarBinary(32), hashSessionToken(token))
      .query('DELETE FROM dbo.Sessions WHERE TokenHash = @hash')
  }
  store.delete(COOKIE)
}
