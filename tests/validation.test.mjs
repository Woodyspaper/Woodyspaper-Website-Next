import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCode, checkEmail, checkName, checkPassword } from '../src/server/validation.ts'

test('emails are trimmed and lower-cased; junk is refused', () => {
  assert.deepEqual(checkEmail('  Pat@Example.COM '), { ok: true, value: 'pat@example.com' })
  for (const bad of ['', 'pat', 'pat@', '@example.com', 'pat@example', 'a b@example.com', 42, null, 'x'.repeat(250) + '@e.co']) {
    assert.equal(checkEmail(bad).ok, false, String(bad))
  }
})

test('names are tidied and capped', () => {
  assert.deepEqual(checkName('  Pat   Doe '), { ok: true, value: 'Pat Doe' })
  assert.equal(checkName('   ').ok, false)
  assert.equal(checkName('x'.repeat(101)).ok, false)
})

test('passwords need 10 to 200 characters and are not trimmed', () => {
  assert.equal(checkPassword('short').ok, false)
  assert.equal(checkPassword('x'.repeat(201)).ok, false)
  assert.deepEqual(checkPassword(' ten chars '), { ok: true, value: ' ten chars ' })
})

test('codes are exactly 6 digits, spaces ignored', () => {
  assert.deepEqual(checkCode('123 456'), { ok: true, value: '123456' })
  for (const bad of ['12345', '1234567', 'abcdef', '', 123456]) assert.equal(checkCode(bad).ok, false, String(bad))
})
