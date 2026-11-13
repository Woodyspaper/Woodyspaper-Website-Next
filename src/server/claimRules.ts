/*
 * What to do when a signed-in visitor asks to be matched to the customer
 * account under an email address. Pure rules (no database, no email), so
 * tests/claimRules.test.mjs can run them; customers.ts carries them out.
 *
 * The one thing these rules protect: for an address that isn't the visitor's
 * own confirmed email, the screen must say the same thing whatever we hold
 * under it, so nobody can use the form to find out who our customers are.
 */

/** A customer that has the email: its id, and the website account it is matched to (null = none yet). */
export type ClaimCandidate = { id: number; userId: number | null }

export type ClaimDecision =
  /** Their own confirmed email, on exactly one unmatched customer: match now. */
  | { action: 'match'; customerId: number }
  /** Their own confirmed email is on no customer account: say so. */
  | { action: 'noCustomer' }
  /** Their own confirmed email is on several customer accounts: ask them to call. */
  | { action: 'sharedEmail' }
  /** Their own confirmed email is on a customer already matched to another website account. */
  | { action: 'taken' }
  /** Another address, on exactly one unmatched customer: email it a code. The screen says only "if…, we sent a code". */
  | { action: 'sendCode' }
  /** Another address, on several customers: email it a note asking them to call. Same screen. */
  | { action: 'emailToCall' }
  /** Another address we can do nothing with (no customer, or already matched). Same screen. */
  | { action: 'nothing' }

/** The outcomes that all look the same on screen: every one for an address that isn't the visitor's own. */
export const SAME_ON_SCREEN: readonly ClaimDecision['action'][] = ['sendCode', 'emailToCall', 'nothing']

/**
 * `accountEmail` is the visitor's own confirmed email; `enteredEmail` the one
 * they typed; both lower case. `candidates` are the active customers holding
 * the typed email.
 */
export function decideClaim(accountEmail: string, enteredEmail: string, candidates: readonly ClaimCandidate[]): ClaimDecision {
  if (enteredEmail === accountEmail) {
    if (candidates.length === 0) return { action: 'noCustomer' }
    if (candidates.length > 1) return { action: 'sharedEmail' }
    return candidates[0].userId === null ? { action: 'match', customerId: candidates[0].id } : { action: 'taken' }
  }
  if (candidates.length > 1) return { action: 'emailToCall' }
  if (candidates.length === 1 && candidates[0].userId === null) return { action: 'sendCode' }
  return { action: 'nothing' }
}

/**
 * After the emailed code was entered correctly: the customer to match, or
 * null when the email no longer points at exactly one unmatched customer.
 */
export function customerForConfirmedClaim(candidates: readonly ClaimCandidate[]): number | null {
  return candidates.length === 1 && candidates[0].userId === null ? candidates[0].id : null
}
