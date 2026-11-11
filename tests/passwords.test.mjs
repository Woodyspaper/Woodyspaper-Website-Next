import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decoyHash, hashPassword, verifyPassword } from '../src/server/passwords.ts'

test('a password verifies against its own hash only', async () => {
  const hash = await hashPassword('correct horse battery')
  assert.match(hash, /^scrypt\$32768\$8\$3\$/)
  assert.ok(!hash.includes('correct horse'))
  assert.equal(await verifyPassword('correct horse battery', hash), true)
  assert.equal(await verifyPassword('correct horse batterx', hash), false)
  assert.equal(await verifyPassword('', hash), false)
})

test('the same password hashes differently each time (random salt)', async () => {
  assert.notEqual(await hashPassword('same password'), await hashPassword('same password'))
})

test('malformed stored values never verify', async () => {
  for (const stored of ['', 'plain', 'scrypt$0$8$3$AAAA$AAAA', 'scrypt$99999999999$8$3$AAAA$AAAA', 'bcrypt$1$2$3$a$b']) {
    assert.equal(await verifyPassword('anything', stored), false, stored)
  }
})

test('the decoy hash is a real hash that nothing matches', async () => {
  assert.equal(await verifyPassword('', await decoyHash()), false)
})
