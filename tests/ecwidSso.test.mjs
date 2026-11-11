import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { buildSsoPayload } from '../src/server/ecwidSso.ts'

const profile = { clientId: 'my-app', clientSecret: 'shh', userId: 234, email: 'pat@example.com', name: 'Pat Doe', now: 1421317550 }

test('payload is "<base64 json> <hmac-sha256 hex> <timestamp>"', () => {
  const [message, signature, timestamp, ...rest] = buildSsoPayload(profile).split(' ')
  assert.equal(rest.length, 0)
  assert.equal(timestamp, '1421317550')
  assert.deepEqual(JSON.parse(Buffer.from(message, 'base64').toString('utf8')), {
    appClientId: 'my-app',
    userId: '234',
    profile: { email: 'pat@example.com', billingPerson: { name: 'Pat Doe' } },
  })
  // Same construction as Ecwid's PHP example: hash_hmac('sha256', "$message $timestamp", $client_secret)
  assert.equal(signature, createHmac('sha256', 'shh').update(`${message} 1421317550`).digest('hex'))
  assert.match(signature, /^[0-9a-f]{64}$/)
})

test('a different secret or time gives a different signature', () => {
  const base = buildSsoPayload(profile).split(' ')[1]
  assert.notEqual(buildSsoPayload({ ...profile, clientSecret: 'other' }).split(' ')[1], base)
  assert.notEqual(buildSsoPayload({ ...profile, now: 1421317551 }).split(' ')[1], base)
})

test('names with non-ASCII characters survive the encoding', () => {
  const [message] = buildSsoPayload({ ...profile, name: 'José Ñandú' }).split(' ')
  assert.equal(JSON.parse(Buffer.from(message, 'base64').toString('utf8')).profile.billingPerson.name, 'José Ñandú')
})
