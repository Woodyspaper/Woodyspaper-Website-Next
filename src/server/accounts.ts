import 'server-only'
import { query, sql } from './db'
import { ApiError } from './http'
import { codeEmail, passwordChangedEmail, sendMail } from './mailer'
import { decoyHash, hashPassword, verifyPassword } from './passwords'
import { countAttempts, ipBucket, limit, limitByIp, recordAttempt } from './rateLimit'
import { endOtherSessions } from './sessions'
import { hashCode, newCode, sameHash } from './tokens'

/* Website accounts: sign-up, sign-in, emailed codes, password reset. */

/** claim = prove a website account belongs to one of our customers (customers.ts). */
export type CodePurpose = 'verify' | 'link' | 'reset' | 'claim'

const CODE_MINUTES = 15
const CODE_MAX_TRIES = 5

function authSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be set to at least 32 random characters.')
  return secret
}

/**
 * Creates a code for this account, replacing any earlier one of the same
 * purpose, and returns it for emailing. At most 5 per hour per purpose.
 */
export async function issueCode(
  userId: number,
  purpose: CodePurpose,
  targetEmail: string,
  ecwidCustomerId: number | null = null,
): Promise<string> {
  await limit(`code-${purpose}`, String(userId), 5, 60)
  const code = newCode()
  await (await query())
    .input('userId', sql.Int, userId)
    .input('purpose', sql.VarChar(10), purpose)
    .input('email', sql.NVarChar(254), targetEmail)
    .input('customerId', sql.BigInt, ecwidCustomerId)
    .input('hash', sql.VarBinary(32), hashCode(code, purpose, userId, authSecret()))
    .input('minutes', sql.Int, CODE_MINUTES)
    .query(
      `UPDATE dbo.EmailCodes SET UsedAt = SYSUTCDATETIME()
       WHERE UserId = @userId AND Purpose = @purpose AND UsedAt IS NULL;
       INSERT INTO dbo.EmailCodes (UserId, Purpose, TargetEmail, EcwidCustomerId, CodeHash, ExpiresAt)
       VALUES (@userId, @purpose, @email, @customerId, @hash, DATEADD(MINUTE, @minutes, SYSUTCDATETIME()));`,
    )
  return code
}

export async function sendCode(
  userId: number,
  purpose: CodePurpose,
  targetEmail: string,
  ecwidCustomerId: number | null = null,
): Promise<void> {
  const code = await issueCode(userId, purpose, targetEmail, ecwidCustomerId)
  await sendMail({ to: targetEmail, ...codeEmail(purpose, code, CODE_MINUTES) })
}

export type ConsumedCode = { targetEmail: string; ecwidCustomerId: number | null }

/**
 * Checks a code. Each code works once, expires after 15 minutes and allows
 * 5 tries. Returns what the code was issued for, or null if it's wrong.
 */
export async function consumeCode(userId: number, purpose: CodePurpose, code: string): Promise<ConsumedCode | null> {
  const found = await (await query())
    .input('userId', sql.Int, userId)
    .input('purpose', sql.VarChar(10), purpose)
    .query<{ Id: number; CodeHash: Buffer; TargetEmail: string; EcwidCustomerId: string | number | null }>(
      `SELECT TOP 1 Id, CodeHash, TargetEmail, EcwidCustomerId FROM dbo.EmailCodes
       WHERE UserId = @userId AND Purpose = @purpose AND UsedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
       ORDER BY Id DESC`,
    )
  const row = found.recordset[0]
  if (!row) return null

  // Count the try first, so parallel guesses can't share one attempt.
  const counted = await (await query())
    .input('id', sql.BigInt, row.Id)
    .input('max', sql.Int, CODE_MAX_TRIES)
    .query('UPDATE dbo.EmailCodes SET Attempts = Attempts + 1 WHERE Id = @id AND Attempts < @max')
  if (counted.rowsAffected[0] !== 1) return null
  if (!sameHash(row.CodeHash, hashCode(code, purpose, userId, authSecret()))) return null

  const used = await (await query())
    .input('id', sql.BigInt, row.Id)
    .query('UPDATE dbo.EmailCodes SET UsedAt = SYSUTCDATETIME() WHERE Id = @id AND UsedAt IS NULL')
  if (used.rowsAffected[0] !== 1) return null
  return {
    targetEmail: row.TargetEmail,
    ecwidCustomerId: row.EcwidCustomerId === null ? null : Number(row.EcwidCustomerId),
  }
}

type UserRow = { Id: number; PasswordHash: string; EmailVerifiedAt: Date | null }

async function findUser(email: string): Promise<UserRow | undefined> {
  const result = await (await query())
    .input('email', sql.NVarChar(254), email)
    .query<UserRow>('SELECT Id, PasswordHash, EmailVerifiedAt FROM dbo.Users WHERE Email = @email')
  return result.recordset[0]
}

/** Creates the account, emails a confirmation code, and returns the new account's id. */
export async function signUp(name: string, email: string, password: string, ip: string | null): Promise<number> {
  await limitByIp('signup', ip, 10, 60)
  const existing = await findUser(email)
  if (existing?.EmailVerifiedAt) {
    throw new ApiError(409, 'An account with this email already exists. Sign in instead.')
  }
  const passwordHash = await hashPassword(password)
  let userId: number
  if (existing) {
    // Signed up before but never confirmed the email: whoever confirms it owns
    // the account, so start over and sign out anything from the earlier try.
    userId = existing.Id
    await (await query())
      .input('id', sql.Int, userId)
      .input('name', sql.NVarChar(100), name)
      .input('hash', sql.NVarChar(300), passwordHash)
      .query(
        `UPDATE dbo.Users SET Name = @name, PasswordHash = @hash WHERE Id = @id AND EmailVerifiedAt IS NULL;
         DELETE FROM dbo.Sessions WHERE UserId = @id;`,
      )
  } else {
    const created = await (await query())
      .input('name', sql.NVarChar(100), name)
      .input('email', sql.NVarChar(254), email)
      .input('hash', sql.NVarChar(300), passwordHash)
      .query<{ Id: number }>(
        'INSERT INTO dbo.Users (Name, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@name, @email, @hash)',
      )
    userId = created.recordset[0].Id
  }
  try {
    await sendCode(userId, 'verify', email)
  } catch (error) {
    // The mail server refused the address outright (no such mailbox): say so,
    // rather than a generic failure, so a mistyped email can be corrected.
    if ((error as { code?: string }).code === 'EENVELOPE') {
      console.error('Sign-up email refused by the mail server:', (error as { response?: string }).response)
      throw new ApiError(422, 'We couldn’t send an email to that address. Check it for typos, or use a different email.')
    }
    throw error
  }
  return userId
}

export async function markEmailVerified(userId: number): Promise<void> {
  await (await query())
    .input('id', sql.Int, userId)
    .query('UPDATE dbo.Users SET EmailVerifiedAt = SYSUTCDATETIME() WHERE Id = @id AND EmailVerifiedAt IS NULL')
}

const BAD_LOGIN = 'That email and password don’t match an account.'

/** Returns the account's id, or throws. Failures are throttled per email and per address. */
export async function signIn(email: string, password: string, ip: string | null): Promise<number> {
  const address = ipBucket(ip, 30)
  const [byEmail, byIp] = await Promise.all([
    countAttempts('login-email', email, 15),
    countAttempts('login-ip', address.key, 15),
  ])
  if (byEmail >= 10 || byIp >= address.max) {
    throw new ApiError(429, 'Too many sign-in attempts. Please wait 15 minutes and try again.')
  }
  const user = await findUser(email)
  // An unknown email still does the hashing work, so both cases take the same time.
  const matches = await verifyPassword(password, user?.PasswordHash ?? (await decoyHash()))
  if (!user || !matches) {
    await Promise.all([recordAttempt('login-email', email), recordAttempt('login-ip', address.key)])
    throw new ApiError(401, BAD_LOGIN)
  }
  return user.Id
}

/** Emails a reset code if the account exists. Says nothing either way. */
export async function requestPasswordReset(email: string, ip: string | null): Promise<void> {
  await limitByIp('reset-ip', ip, 10, 60)
  const user = await findUser(email)
  if (!user) return
  try {
    await sendCode(user.Id, 'reset', email)
  } catch (error) {
    // Hitting the per-account limit must look the same as success.
    if (!(error instanceof ApiError)) throw error
  }
}

export async function resetPassword(email: string, code: string, password: string, ip: string | null): Promise<number> {
  await limitByIp('reset-try-ip', ip, 30, 60)
  const user = await findUser(email)
  const consumed = user ? await consumeCode(user.Id, 'reset', code) : null
  if (!user || !consumed) throw new ApiError(400, 'That code is wrong or has expired. Request a new one.')
  await (await query())
    .input('id', sql.Int, user.Id)
    .input('hash', sql.NVarChar(300), await hashPassword(password))
    .query(
      // The code went to their inbox, so the email is confirmed too. Every
      // browser is signed out: a reset usually means the password leaked.
      `UPDATE dbo.Users SET PasswordHash = @hash, EmailVerifiedAt = COALESCE(EmailVerifiedAt, SYSUTCDATETIME()) WHERE Id = @id;
       DELETE FROM dbo.Sessions WHERE UserId = @id;`,
    )
  return user.Id
}

/** Changes the name shown on the account. */
export async function changeName(userId: number, name: string): Promise<void> {
  await (await query())
    .input('id', sql.Int, userId)
    .input('name', sql.NVarChar(100), name)
    .query('UPDATE dbo.Users SET Name = @name WHERE Id = @id')
}

/**
 * Changes the password of a signed-in account. The current password is
 * asked for again, so a browser left signed in can't be used to take the
 * account over. Other browsers are signed out and the owner is emailed.
 */
export async function changePassword(
  user: { id: number; email: string },
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  // Guessing the current password from a signed-in browser is throttled like sign-in.
  await limit('password-change', String(user.id), 10, 15)
  const found = await (await query())
    .input('id', sql.Int, user.id)
    .query<{ PasswordHash: string }>('SELECT PasswordHash FROM dbo.Users WHERE Id = @id')
  const stored = found.recordset[0]?.PasswordHash
  if (!stored || !(await verifyPassword(currentPassword, stored))) {
    throw new ApiError(400, 'Your current password isn’t right.')
  }
  await (await query())
    .input('id', sql.Int, user.id)
    .input('hash', sql.NVarChar(300), await hashPassword(newPassword))
    .query('UPDATE dbo.Users SET PasswordHash = @hash WHERE Id = @id')
  await endOtherSessions(user.id)
  try {
    await sendMail({ to: user.email, ...passwordChangedEmail() })
  } catch (error) {
    // The password is changed either way; the notice is a courtesy.
    console.error('Password-change notice could not be sent', error)
  }
}
