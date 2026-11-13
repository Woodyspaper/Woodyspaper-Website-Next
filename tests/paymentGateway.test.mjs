import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GatewayNotConfigured,
  centsToAmount,
  chargeToken,
  declineMessage,
  gatewayConfigFromEnv,
  lookupCharge,
  readLookup,
  refundTransaction,
  voidTransaction,
} from '../src/server/payments/gateway.ts'

// Made-up values. No real key or token appears anywhere in these tests, and
// nothing here talks to the gateway: `fetch` is replaced by a stand-in.
const KEY = 'test-security-key-0000'
const TOKEN = '00000000-AAAAAA-BBBBBB-CCCCCCCCCCCC'
const URL_BASE = 'https://gateway.example'

/**
 * A stand-in for fetch that plays back the given answers in order and keeps
 * what was sent. An answer is a body string, { status, body }, or an Error to throw.
 */
function fakeGateway(...answers) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, form: Object.fromEntries(new URLSearchParams(init.body)) })
    const answer = answers.shift()
    if (answer === undefined) throw new Error('unexpected extra request')
    if (answer instanceof Error) throw answer
    const { status = 200, body } = typeof answer === 'string' ? { body: answer } : answer
    return new Response(body, { status })
  }
  return { calls, config: { url: URL_BASE, securityKey: KEY, fetch, lookupDelaysMs: [0, 0], timeoutMs: 1000 } }
}

const reply = (fields) => new URLSearchParams({ authcode: '', transactionid: '', avsresponse: '', cvvresponse: '', orderid: 'W100001', type: 'sale', ...fields }).toString()
const APPROVED = reply({ response: '1', responsetext: 'SUCCESS', authcode: '123456', transactionid: '9876543210', avsresponse: 'Y', cvvresponse: 'M', response_code: '100' })

const named = (name, code) => Object.assign(new Error(name), { name, cause: code ? { code } : undefined })
const TIMEOUT = named('TimeoutError')

/** A Query API answer holding one transaction for the order. */
const lookupXml = ({ orderId = 'W100001', condition = 'pendingsettlement', success = '1', amount = '107.00', responseCode = '100', text = 'SUCCESS', id = '9876543210' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<nm_response>
  <transaction>
    <transaction_id>${id}</transaction_id>
    <transaction_type>cc</transaction_type>
    <condition>${condition}</condition>
    <order_id>${orderId}</order_id>
    <authorization_code>123456</authorization_code>
    <avs_response>Y</avs_response>
    <csc_response>M</csc_response>
    <action>
      <amount>${amount}</amount>
      <action_type>sale</action_type>
      <success>${success}</success>
      <response_text>${text}</response_text>
      <response_code>${responseCode}</response_code>
    </action>
  </transaction>
</nm_response>`
const NOTHING_FOUND = '<?xml version="1.0" encoding="UTF-8"?>\n<nm_response>\n</nm_response>'

const REQUEST = {
  token: TOKEN,
  amountCents: 10700,
  orderNumber: 'W100001',
  billing: { firstName: 'Test', lastName: 'Buyer', address1: '1 Test St', city: 'Testville', state: 'FL', zip: '33312', country: 'US', email: 'buyer@example.com' },
  ip: '203.0.113.9',
  taxCents: 700,
  shippingCents: 0,
}

test('an approved charge: what is sent, and what comes back', async () => {
  const gateway = fakeGateway(APPROVED)
  const result = await chargeToken(REQUEST, gateway.config)
  assert.deepEqual(result, {
    status: 'approved',
    transactionId: '9876543210',
    authCode: '123456',
    responseCode: '100',
    responseText: 'SUCCESS',
    avsResult: 'Y',
    cvvResult: 'M',
    recovered: false,
  })
  assert.equal(gateway.calls.length, 1)
  const [call] = gateway.calls
  assert.equal(call.url, 'https://gateway.example/api/transact.php')
  assert.equal(call.method, 'POST')
  assert.deepEqual(call.form, {
    type: 'sale',
    security_key: KEY,
    payment_token: TOKEN,
    amount: '107.00',
    orderid: 'W100001',
    order_description: 'Website order W100001',
    first_name: 'Test',
    last_name: 'Buyer',
    address1: '1 Test St',
    city: 'Testville',
    state: 'FL',
    zip: '33312',
    country: 'US',
    email: 'buyer@example.com',
    ipaddress: '203.0.113.9',
    tax: '7.00',
    shipping: '0.00',
  })
  // Card details are never part of the request: only the token stands in for them.
  for (const name of ['ccnumber', 'ccexp', 'cvv']) assert.equal(name in call.form, false)
})

test('amounts are sent as dollars and cents, exactly', () => {
  assert.equal(centsToAmount(5), '0.05')
  assert.equal(centsToAmount(100), '1.00')
  assert.equal(centsToAmount(123456789), '1234567.89')
})

test('a decline gives the customer a plain message and is not looked up or retried', async () => {
  const gateway = fakeGateway(reply({ response: '2', responsetext: 'DECLINE', transactionid: '555', response_code: '202' }))
  const result = await chargeToken(REQUEST, gateway.config)
  assert.equal(result.status, 'declined')
  assert.equal(result.responseCode, '202')
  assert.equal(result.transactionId, '555')
  assert.match(result.message, /insufficient funds/)
  assert.equal(gateway.calls.length, 1)
})

test('decline messages: helpful where it is safe, the same plain one for lost, stolen and fraud', () => {
  assert.match(declineMessage('223'), /expired/)
  assert.match(declineMessage('225'), /security code/)
  const plain = declineMessage('200')
  for (const code of ['250', '251', '252', '253', '201', '204', '999', '']) assert.equal(declineMessage(code), plain)
  assert.doesNotMatch(plain, /stolen|lost|fraud/i)
})

test('a gateway error says nothing was charged; only passing faults are worth another try', async () => {
  const setup = fakeGateway(reply({ response: '3', responsetext: 'Authentication Failed', transactionid: '0', response_code: '300' }))
  const failed = await chargeToken(REQUEST, setup.config)
  assert.equal(failed.status, 'error')
  assert.equal(failed.charged, 'no')
  assert.equal(failed.retryable, false)
  assert.equal(failed.responseCode, '300')
  assert.equal(setup.calls.length, 1)

  for (const code of ['301', '420', '421']) {
    const passing = fakeGateway(reply({ response: '3', responsetext: 'Try later', response_code: code }))
    const result = await chargeToken(REQUEST, passing.config)
    assert.equal(result.charged, 'no')
    assert.equal(result.retryable, true, code)
  }

  const limited = fakeGateway({ status: 429, body: 'Too Many Requests' })
  const result = await chargeToken(REQUEST, limited.config)
  assert.deepEqual([result.status, result.charged, result.retryable], ['error', 'no', true])
  assert.equal(limited.calls.length, 1)
})

test('time-out, then the look-up finds the charge approved: reported as approved, charged once', async () => {
  const gateway = fakeGateway(TIMEOUT, lookupXml())
  const result = await chargeToken(REQUEST, gateway.config)
  assert.equal(result.status, 'approved')
  assert.equal(result.recovered, true)
  assert.equal(result.transactionId, '9876543210')
  assert.equal(result.authCode, '123456')
  // One charge request, then one look-up. Never a second charge.
  assert.deepEqual(gateway.calls.map((c) => c.url), ['https://gateway.example/api/transact.php', 'https://gateway.example/api/query.php'])
  assert.deepEqual(gateway.calls[1].form, { security_key: KEY, order_id: 'W100001' })
  assert.equal(gateway.calls.filter((c) => c.form.type === 'sale').length, 1)
})

test('time-out, and the charge shows up only on the second look-up', async () => {
  const gateway = fakeGateway(TIMEOUT, NOTHING_FOUND, lookupXml({ condition: 'complete' }))
  const result = await chargeToken(REQUEST, gateway.config)
  assert.equal(result.status, 'approved')
  assert.equal(gateway.calls.length, 3)
})

test('time-out, and the gateway has nothing: not known, never charged again', async () => {
  const gateway = fakeGateway(TIMEOUT, NOTHING_FOUND, NOTHING_FOUND)
  const result = await chargeToken(REQUEST, gateway.config)
  assert.equal(result.status, 'error')
  assert.equal(result.charged, 'unknown')
  assert.equal(result.retryable, false)
  assert.match(result.message, /do not try again/)
  assert.match(result.detail, /no answer within/)
  assert.equal(gateway.calls.filter((c) => c.url.endsWith('transact.php')).length, 1)
})

test('time-out, and the look-up fails too: not known', async () => {
  const gateway = fakeGateway(TIMEOUT, TIMEOUT, { status: 503, body: 'down' })
  const result = await chargeToken(REQUEST, gateway.config)
  assert.deepEqual([result.status, result.charged], ['error', 'unknown'])
  assert.equal(gateway.calls.length, 3)
})

test('time-out, then the look-up finds it declined or failed', async () => {
  const declined = fakeGateway(TIMEOUT, lookupXml({ condition: 'failed', success: '0', responseCode: '223', text: 'EXPIRED CARD' }))
  const first = await chargeToken(REQUEST, declined.config)
  assert.equal(first.status, 'declined')
  assert.match(first.message, /expired/)

  const failed = fakeGateway(TIMEOUT, lookupXml({ condition: 'failed', success: '0', responseCode: '420', text: 'COMM ERROR' }))
  const second = await chargeToken(REQUEST, failed.config)
  assert.deepEqual([second.status, second.charged, second.retryable], ['error', 'no', true])
})

test('a look-up that finds a different amount is not trusted', async () => {
  const gateway = fakeGateway(TIMEOUT, lookupXml({ amount: '10.00' }))
  const result = await chargeToken(REQUEST, gateway.config)
  assert.deepEqual([result.status, result.charged], ['error', 'unknown'])
  assert.match(result.detail, /10\.00, not 107\.00/)
})

test('a server error, a garbled answer or an approval with no transaction number is looked up, not assumed', async () => {
  for (const first of [{ status: 502, body: 'Bad Gateway' }, '<html>maintenance</html>', reply({ response: '1', responsetext: 'SUCCESS', response_code: '100' }), named('TypeError')]) {
    const gateway = fakeGateway(first, lookupXml())
    const result = await chargeToken(REQUEST, gateway.config)
    assert.equal(result.status, 'approved')
    assert.equal(result.recovered, true)
    assert.equal(gateway.calls.length, 2)
  }
})

test('"duplicate transaction" means the first try got through: looked up and reported as approved', async () => {
  const gateway = fakeGateway(reply({ response: '3', responsetext: 'Duplicate transaction REFID:123', response_code: '300' }), lookupXml())
  const result = await chargeToken(REQUEST, gateway.config)
  assert.equal(result.status, 'approved')
  assert.equal(result.recovered, true)
})

test('a connection that was never made is a plain "not charged", with no look-up', async () => {
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']) {
    const gateway = fakeGateway(named('TypeError', code))
    const result = await chargeToken(REQUEST, gateway.config)
    assert.deepEqual([result.status, result.charged, result.retryable], ['error', 'no', true])
    assert.equal(gateway.calls.length, 1)
  }
})

test('bad input is refused before anything is sent', async () => {
  for (const bad of [{ token: '' }, { token: 'has spaces in it' }, { amountCents: 0 }, { amountCents: -100 }, { amountCents: 10.5 }, { orderNumber: '' }, { orderNumber: 'W1&type=refund' }]) {
    const gateway = fakeGateway()
    const result = await chargeToken({ ...REQUEST, ...bad }, gateway.config)
    assert.deepEqual([result.status, result.charged], ['error', 'no'], JSON.stringify(bad))
    assert.equal(gateway.calls.length, 0)
  }
})

test('only a dotted internet address is passed on, and blank billing fields are left out', async () => {
  const gateway = fakeGateway(APPROVED)
  await chargeToken({ token: TOKEN, amountCents: 500, orderNumber: 'W100002', billing: { firstName: '  ', zip: '33312' }, ip: '2001:db8::1' }, gateway.config)
  assert.deepEqual(Object.keys(gateway.calls[0].form).sort(), ['amount', 'order_description', 'orderid', 'payment_token', 'security_key', 'type', 'zip'])
})

test('the token and the key never appear in anything returned', async () => {
  const answers = [
    [reply({ response: '3', responsetext: `Payment Token ${TOKEN} does not exist for key ${KEY}`, response_code: '300' })],
    [reply({ response: '2', responsetext: `DECLINE ${TOKEN}`, response_code: '200' })],
    [TIMEOUT, `<nm_response><error_response>Invalid key ${KEY}</error_response></nm_response>`, NOTHING_FOUND],
    [TIMEOUT, lookupXml({ condition: 'failed', success: '0', responseCode: '300', text: `bad ${TOKEN}` })],
  ]
  for (const set of answers) {
    const result = await chargeToken(REQUEST, fakeGateway(...set).config)
    const text = JSON.stringify(result)
    assert.equal(text.includes(TOKEN), false, text)
    assert.equal(text.includes(KEY), false, text)
  }
})

test('reading a look-up answer', () => {
  assert.equal(readLookup(lookupXml(), 'W100001').found, 'approved')
  assert.equal(readLookup(lookupXml(), 'W100001').amountCents, 10700)
  // Another order's transaction is ignored, even if the gateway returned it.
  assert.deepEqual(readLookup(lookupXml({ orderId: 'W100009' }), 'W100001'), { found: 'none' })
  assert.deepEqual(readLookup(lookupXml({ condition: 'canceled' }), 'W100001'), { found: 'voided', transactionId: '9876543210' })
  assert.equal(readLookup(lookupXml({ condition: 'unknown' }), 'W100001').found, 'unknown')
  assert.equal(readLookup(lookupXml({ condition: 'pending' }), 'W100001').found, 'unknown')
  assert.deepEqual(readLookup(NOTHING_FOUND, 'W100001'), { found: 'none' })
  assert.equal(readLookup('not xml at all', 'W100001').found, 'unknown')
  assert.equal(readLookup('<nm_response><error_response>Authentication Failed</error_response></nm_response>', 'W100001').found, 'unknown')
  // A declined first try followed by an approved second try on the same order: approved wins.
  const both = lookupXml({ condition: 'failed', success: '0', id: '111' }).replace('</nm_response>', '') + lookupXml({ id: '222' }).replace(/^[\s\S]*?<nm_response>/, '')
  assert.deepEqual([readLookup(both, 'W100001').found, readLookup(both, 'W100001').transactionId], ['approved', '222'])
})

test('a look-up can be made on its own', async () => {
  const gateway = fakeGateway(lookupXml())
  const result = await lookupCharge('W100001', gateway.config)
  assert.equal(result.found, 'approved')
  assert.equal(gateway.calls[0].url, 'https://gateway.example/api/query.php')
})

test('void: sends the transaction number and reports the outcome', async () => {
  const gateway = fakeGateway(reply({ response: '1', responsetext: 'Transaction Void Successful', transactionid: '9876543210', type: 'void', response_code: '100' }))
  const result = await voidTransaction('9876543210', gateway.config)
  assert.deepEqual(result, { ok: true, transactionId: '9876543210', responseText: 'Transaction Void Successful' })
  assert.deepEqual(gateway.calls[0].form, { type: 'void', transactionid: '9876543210', security_key: KEY })

  const refused = await voidTransaction('9876543210', fakeGateway(reply({ response: '3', responsetext: 'Only transactions pending settlement can be voided', response_code: '300' })).config)
  assert.deepEqual([refused.ok, refused.outcomeKnown, refused.responseCode], [false, true, '300'])
  assert.match(refused.message, /pending settlement/)

  const malformed = fakeGateway()
  assert.equal((await voidTransaction('abc; drop', malformed.config)).ok, false)
  assert.equal(malformed.calls.length, 0)
})

test('refund: sends the amount; a lost answer is never retried', async () => {
  const gateway = fakeGateway(reply({ response: '1', responsetext: 'SUCCESS', transactionid: '9876543299', type: 'refund', response_code: '100' }))
  const result = await refundTransaction('9876543210', 2550, gateway.config)
  assert.equal(result.ok, true)
  assert.equal(result.transactionId, '9876543299')
  assert.deepEqual(gateway.calls[0].form, { type: 'refund', transactionid: '9876543210', amount: '25.50', security_key: KEY })

  const lost = fakeGateway(TIMEOUT)
  const unknown = await refundTransaction('9876543210', 2550, lost.config)
  assert.deepEqual([unknown.ok, unknown.outcomeKnown], [false, false])
  assert.match(unknown.message, /Check the gateway/)
  assert.equal(lost.calls.length, 1)

  const none = fakeGateway()
  assert.equal((await refundTransaction('9876543210', 0, none.config)).ok, false)
  assert.equal(none.calls.length, 0)
})

test('settings: the key is required, the address defaults to the store’s gateway and must be https', () => {
  assert.throws(() => gatewayConfigFromEnv({}), GatewayNotConfigured)
  assert.deepEqual(gatewayConfigFromEnv({ PAYMENT_SECURITY_KEY: ` ${KEY} ` }), { url: 'https://secure.pmtboxgw.com', securityKey: KEY })
  assert.equal(gatewayConfigFromEnv({ PAYMENT_SECURITY_KEY: KEY, PAYMENT_GATEWAY_URL: 'https://gateway.example/' }).url, 'https://gateway.example')
  assert.throws(() => gatewayConfigFromEnv({ PAYMENT_SECURITY_KEY: KEY, PAYMENT_GATEWAY_URL: 'http://gateway.example' }), /https/)
  assert.throws(() => gatewayConfigFromEnv({ PAYMENT_SECURITY_KEY: KEY, PAYMENT_GATEWAY_URL: 'https://gateway.example/api/transact.php' }), /https/)
})
