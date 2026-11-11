import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashCode, hashSessionToken, newCode, newSessionToken, sameHash } from '../src/server/tokens.ts'

test('session tokens are random and stored as a SHA-256 hash', () => {
  const a = newSessionToken()
  const b = newSessionToken()
  assert.notEqual(a.token, b.token)
  assert.ok(a.token.length >= 43)
  assert.equal(a.hash.length, 32)
  assert.ok(sameHash(a.hash, hashSessionToken(a.token)))
  assert.ok(!sameHash(a.hash, b.hash))
})

test('codes are always 6 digits', () => {
  for (let i = 0; i < 2000; i++) assert.match(newCode(), /^\d{6}$/)
})

test('a code hash is bound to its purpose, account and the server secret', () => {
  const hash = hashCode('123456', 'verify', 7, 'secret-a')
  assert.ok(sameHash(hash, hashCode(' 123456 ', 'verify', 7, 'secret-a')))
  assert.ok(!sameHash(hash, hashCode('123457', 'verify', 7, 'secret-a')))
  assert.ok(!sameHash(hash, hashCode('123456', 'reset', 7, 'secret-a')))
  assert.ok(!sameHash(hash, hashCode('123456', 'verify', 8, 'secret-a')))
  assert.ok(!sameHash(hash, hashCode('123456', 'verify', 7, 'secret-b')))
})

test('sameHash rejects different lengths instead of throwing', () => {
  assert.equal(sameHash(Buffer.alloc(32), Buffer.alloc(16)), false)
})
