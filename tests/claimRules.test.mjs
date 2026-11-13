import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAME_ON_SCREEN, customerForConfirmedClaim, decideClaim } from '../src/server/claimRules.ts'

const ME = 'buyer@example.com'
const OTHER = 'office@example.com'
const free = (id) => ({ id, userId: null })
const matched = (id) => ({ id, userId: 77 })

test('own confirmed email on exactly one unmatched customer: matched at once', () => {
  assert.deepEqual(decideClaim(ME, ME, [free(12)]), { action: 'match', customerId: 12 })
})

test('own confirmed email: told plainly when there is no customer, several, or it is taken', () => {
  assert.deepEqual(decideClaim(ME, ME, []), { action: 'noCustomer' })
  assert.deepEqual(decideClaim(ME, ME, [free(1), free(2)]), { action: 'sharedEmail' })
  // Several customers share it: never guessed, even when only one of them is still unmatched.
  assert.deepEqual(decideClaim(ME, ME, [free(1), matched(2)]), { action: 'sharedEmail' })
  assert.deepEqual(decideClaim(ME, ME, [matched(1)]), { action: 'taken' })
})

test('another address: a code only when exactly one unmatched customer has it', () => {
  assert.deepEqual(decideClaim(ME, OTHER, [free(5)]), { action: 'sendCode' })
  assert.deepEqual(decideClaim(ME, OTHER, []), { action: 'nothing' })
  assert.deepEqual(decideClaim(ME, OTHER, [matched(5)]), { action: 'nothing' })
  assert.deepEqual(decideClaim(ME, OTHER, [free(5), free(6)]), { action: 'emailToCall' })
})

test('another address: never matched without a code, and the screen cannot tell the cases apart', () => {
  const cases = [[], [free(5)], [matched(5)], [free(5), free(6)], [free(5), matched(6)], [matched(5), matched(6)]]
  for (const candidates of cases) {
    const decision = decideClaim(ME, OTHER, candidates)
    assert.ok(SAME_ON_SCREEN.includes(decision.action), decision.action)
    assert.equal('customerId' in decision, false)
  }
})

test('after the code: only an email that still points at one unmatched customer', () => {
  assert.equal(customerForConfirmedClaim([free(9)]), 9)
  assert.equal(customerForConfirmedClaim([]), null)
  assert.equal(customerForConfirmedClaim([matched(9)]), null)
  assert.equal(customerForConfirmedClaim([free(9), free(10)]), null)
})
