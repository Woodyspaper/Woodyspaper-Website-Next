import 'server-only'
import { consumeCode, sendCode } from './accounts'
import { customerForConfirmedClaim, decideClaim } from './claimRules'
import type { ClaimCandidate } from './claimRules'
import { query, sql } from './db'
import { ApiError } from './http'
import { claimNeedsCallEmail, sendMail } from './mailer'
import { limit } from './rateLimit'
import type { SessionUser } from './sessions'

/*
 * Matching a website account to one of our customers (dbo.Customers, the
 * customer list imported from Lightspeed Retail). A matched account sees and
 * pays that customer's prices, so the match has to be proven:
 *
 *   - The visitor is signed in and has confirmed their own email.
 *   - They enter the email we hold for them as a customer.
 *   - If that is their own confirmed email and exactly one customer has it,
 *     the match is made at once: they have already shown the inbox is theirs.
 *   - Otherwise a 6-digit code goes to that address, and entering it makes
 *     the match.
 *   - If more than one customer shares the email we can't tell which one
 *     they are, so nothing is matched and they are asked to call.
 *
 * What the screen says never gives away whether some other person's email
 * belongs to a customer: for any address that isn't the visitor's own, the
 * answer is the same whatever we found, and anything more is said only in an
 * email to that address. The decisions themselves are in claimRules.ts,
 * where they are tested; this file carries them out.
 *
 * This sits beside the older link to a Lightspeed eCom store account
 * (lightspeed.ts), which keeps working until the new checkout replaces it.
 */

const PHONE = '(754) 701-1797'
const ALREADY_MATCHED = 'Your account is already matched to a customer account.'
const SHARED_EMAIL = `More than one customer account uses that email, so we can’t match yours automatically. Please call ${PHONE} and we’ll set it up.`
const TAKEN = `That customer account is already matched to another website account. Call ${PHONE} if that’s unexpected.`
const BAD_CODE = 'That code is wrong or has expired. Request a new one.'

/** Every active customer that has this email (lower case), matched to a website account or not. */
async function customersWithEmail(email: string): Promise<ClaimCandidate[]> {
  const found = await (await query())
    .input('email', sql.NVarChar(254), email)
    .query<{ Id: number; UserId: number | null }>('SELECT Id, UserId FROM dbo.Customers WHERE Email = @email AND IsActive = 1')
  return found.recordset.map((row) => ({ id: row.Id, userId: row.UserId }))
}

/** True when this website account is matched to an active customer. */
export async function hasMatchedCustomer(userId: number): Promise<boolean> {
  const found = await (await query())
    .input('userId', sql.Int, userId)
    .query('SELECT 1 AS Found FROM dbo.Customers WHERE UserId = @userId AND IsActive = 1')
  return found.recordset.length > 0
}

/**
 * Makes the match. False when the customer was taken in the meantime or the
 * account got matched elsewhere: the update only goes through while both
 * sides are still free (and a unique index backs that up).
 */
async function matchCustomer(userId: number, customerId: number): Promise<boolean> {
  try {
    const updated = await (await query())
      .input('userId', sql.Int, userId)
      .input('customerId', sql.Int, customerId)
      .query(
        `UPDATE dbo.Customers SET UserId = @userId, UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @customerId AND UserId IS NULL AND IsActive = 1
           AND NOT EXISTS (SELECT 1 FROM dbo.Customers WHERE UserId = @userId)`,
      )
    return updated.rowsAffected[0] === 1
  } catch (error) {
    // 2601 / 2627: unique index — two requests at the same moment; one of them wins.
    const number = (error as { number?: number }).number
    if (number === 2601 || number === 2627) return false
    throw error
  }
}

/**
 * Step 1. `email` is the address the visitor says we hold for them, already
 * checked and in lower case. Returns { linked: true } when the match was made
 * at once, { noCustomer: true } when their own email is on no customer
 * account, and otherwise a plain { linked: false }: a code may or may not be
 * on its way, and the screen says so in those words.
 */
export async function startClaim(user: SessionUser, email: string): Promise<{ linked: boolean; noCustomer?: true }> {
  if (await hasMatchedCustomer(user.id)) throw new ApiError(409, ALREADY_MATCHED)
  await limit('claim-start', String(user.id), 10, 60)
  const decision = decideClaim(user.email, email, await customersWithEmail(email))
  switch (decision.action) {
    // Their own confirmed address: what we hold under it is theirs to know.
    case 'match':
      if (!(await matchCustomer(user.id, decision.customerId))) throw new ApiError(409, TAKEN)
      return { linked: true }
    case 'noCustomer':
      return { linked: false, noCustomer: true }
    case 'sharedEmail':
      throw new ApiError(409, SHARED_EMAIL)
    case 'taken':
      throw new ApiError(409, TAKEN)
    // Someone else's address, as far as we know. Whatever we found, the answer
    // on screen is the same; the rest is said by email to that address.
    case 'sendCode':
    case 'emailToCall':
      try {
        if (decision.action === 'sendCode') {
          await sendCode(user.id, 'claim', email)
        } else {
          // At most three of these notes a day to one address.
          await limit('claim-call', email, 3, 24 * 60)
          await sendMail({ to: email, ...claimNeedsCallEmail() })
        }
      } catch (error) {
        // Too many codes, or the email couldn't go out: saying so here would give
        // away that the address is a customer's. It is logged for us instead.
        if (!(error instanceof ApiError)) console.error('Customer match email could not be sent', error)
      }
      return { linked: false }
    case 'nothing':
      return { linked: false }
  }
}

/** Step 2: the code that was emailed to the customer's address. */
export async function confirmClaim(user: SessionUser, code: string): Promise<void> {
  if (await hasMatchedCustomer(user.id)) throw new ApiError(409, ALREADY_MATCHED)
  const consumed = await consumeCode(user.id, 'claim', code)
  if (!consumed) throw new ApiError(400, BAD_CODE)
  // Looked up again now rather than trusted from step 1: the customer list may have changed in between.
  const customerId = customerForConfirmedClaim(await customersWithEmail(consumed.targetEmail))
  if (customerId === null || !(await matchCustomer(user.id, customerId))) {
    throw new ApiError(409, `We couldn’t match that customer account. Please call ${PHONE} and we’ll set it up.`)
  }
}

/** Undoes the match: the account goes back to list prices. The customer record itself is untouched. */
export async function unclaim(user: SessionUser): Promise<void> {
  await (await query())
    .input('userId', sql.Int, user.id)
    .query('UPDATE dbo.Customers SET UserId = NULL, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @userId')
}
