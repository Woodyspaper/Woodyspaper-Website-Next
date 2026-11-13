import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  DEFAULT_PACKING_RULES,
  UpsNotConfigured,
  buildRateRequest,
  clearUpsTokens,
  parcelsForLines,
  quoteUps,
  readRates,
  upsConfigFromEnv,
} from '../src/server/checkout/ups.ts'

// Made-up credentials. Nothing here talks to UPS: `fetch` is replaced by a stand-in.
const SECRET = 'test-client-secret-0000'
const ACCESS = 'test-access-token-1111'

beforeEach(() => clearUpsTokens())

// ---- boxing ----------------------------------------------------------------

const caseOfPaper = { weightLb: 50, lengthIn: 17.5, widthIn: 11.5, heightIn: 10 }
const boxOfPens = { weightLb: 0.5, lengthIn: 6, widthIn: 4, heightIn: 2 }

test('a heavy item ships as it is: one parcel per unit, with its own size', () => {
  const result = parcelsForLines([{ quantity: 3, ...caseOfPaper }])
  assert.equal(result.ok, true)
  assert.deepEqual(result.parcels, Array(3).fill({ weightLb: 50, lengthIn: 17.5, widthIn: 11.5, heightIn: 10 }))
  assert.equal(result.totalWeightLb, 150)
})

test('a long item ships alone even when light, longest side first', () => {
  const result = parcelsForLines([{ quantity: 1, weightLb: 4, lengthIn: 3, widthIn: 36, heightIn: 3 }])
  assert.deepEqual(result.parcels, [{ weightLb: 4, lengthIn: 36, widthIn: 3, heightIn: 3 }])
})

test('light items share a box sized to hold them', () => {
  const result = parcelsForLines([{ quantity: 20, ...boxOfPens }])
  // 20 x 48 cubic inches = 960, plus 15% = 1104 -> a cube of 11 inches (10.34 rounded up).
  assert.deepEqual(result.parcels, [{ weightLb: 10, lengthIn: 11, widthIn: 11, heightIn: 11 }])
})

test('shared boxes are split by weight and by room', () => {
  // 30 x 4 lb = 120 lb: three boxes at most 50 lb each.
  const byWeight = parcelsForLines([{ quantity: 30, weightLb: 4, lengthIn: 5, widthIn: 5, heightIn: 5 }])
  assert.deepEqual(byWeight.parcels.map((p) => p.weightLb), [48, 48, 24])
  // Bulky and light: 1 lb each but 12 x 12 x 12 (1,728 cubic inches); three fit in 3 cubic feet.
  const byRoom = parcelsForLines([{ quantity: 7, weightLb: 1, lengthIn: 12, widthIn: 12, heightIn: 12 }])
  assert.deepEqual(byRoom.parcels.map((p) => p.weightLb), [3, 3, 1])
  assert.equal(byRoom.parcels[0].lengthIn, 19) // cube root of 5,184 x 1.15 = 18.13 -> 19
})

test('a mixed order: cases alone, small things together', () => {
  const result = parcelsForLines([{ quantity: 2, ...caseOfPaper }, { quantity: 4, ...boxOfPens }, { quantity: 1, weightLb: 3 }])
  assert.equal(result.parcels.length, 3)
  assert.deepEqual(result.parcels.slice(0, 2).map((p) => p.weightLb), [50, 50])
  // The shared box holds an item with no size on file, so it goes to UPS by weight alone.
  assert.deepEqual(result.parcels[2], { weightLb: 5 })
  assert.equal(result.totalWeightLb, 105)
})

test('weights are rounded up to a tenth of a pound, never down', () => {
  assert.deepEqual(parcelsForLines([{ quantity: 1, weightLb: 0.03 }]).parcels, [{ weightLb: 0.1 }])
  assert.deepEqual(parcelsForLines([{ quantity: 3, weightLb: 0.41 }]).parcels, [{ weightLb: 1.3 }])
})

test('an item with no weight means the order cannot be rated', () => {
  for (const weightLb of [null, undefined, 0, -1, NaN]) {
    const result = parcelsForLines([{ quantity: 1, ...caseOfPaper }, { quantity: 2, weightLb }])
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no_weight')
    assert.deepEqual(result.lines, [1])
  }
})

test('items over UPS’s limits cannot go by UPS', () => {
  const tooHeavy = parcelsForLines([{ quantity: 1, weightLb: 151 }])
  assert.deepEqual([tooHeavy.ok, tooHeavy.reason, tooHeavy.lines], [false, 'too_big', [0]])
  assert.equal(parcelsForLines([{ quantity: 1, weightLb: 150 }]).ok, true)
  assert.equal(parcelsForLines([{ quantity: 1, weightLb: 20, lengthIn: 109, widthIn: 2, heightIn: 2 }]).reason, 'too_big')
  // 60 long + girth 2 x (30 + 30) = 180 inches: over 165.
  assert.equal(parcelsForLines([{ quantity: 1, weightLb: 20, lengthIn: 60, widthIn: 30, heightIn: 30 }]).reason, 'too_big')
})

test('too many parcels, or a nonsense quantity, is refused', () => {
  assert.equal(parcelsForLines([{ quantity: DEFAULT_PACKING_RULES.maxParcels + 1, ...caseOfPaper }]).reason, 'too_many')
  assert.equal(parcelsForLines([{ quantity: DEFAULT_PACKING_RULES.maxParcels, ...caseOfPaper }]).ok, true)
  assert.equal(parcelsForLines([{ quantity: 100000, weightLb: 40 }]).reason, 'too_many')
  for (const quantity of [0, -2, 1.5]) assert.equal(parcelsForLines([{ quantity, ...boxOfPens }]).reason, 'bad_quantity')
  assert.deepEqual(parcelsForLines([]), { ok: true, parcels: [], totalWeightLb: 0 })
})

// ---- asking UPS ------------------------------------------------------------

/** Stand-in for UPS: plays back answers in order and keeps what was sent. */
function fakeUps(...answers) {
  clearUpsTokens() // each stand-in starts signed out
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body })
    const answer = answers.shift()
    if (answer === undefined) throw new Error('unexpected extra request')
    if (answer instanceof Error) throw answer
    const { status = 200, body } = answer
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  let clock = 1_000_000
  const config = {
    clientId: 'test-client-id',
    clientSecret: SECRET,
    accountNumber: 'A1B2C3',
    baseUrl: 'https://ups.example',
    shipFromState: 'FL',
    shipFromCity: null,
    serviceCodes: ['03'],
    charge: 'published',
    fetch,
    now: () => clock,
    timeoutMs: 1000,
  }
  return { calls, config, advance: (ms) => (clock += ms) }
}

const TOKEN_OK = { status: 200, body: { token_type: 'Bearer', access_token: ACCESS, expires_in: '14399', status: 'approved' } }
const rated = (...shipments) => ({ status: 200, body: { RateResponse: { Response: { ResponseStatus: { Code: '1' } }, RatedShipment: shipments } } })
const shipment = (code, amount, negotiated) => ({
  Service: { Code: code },
  TotalCharges: { CurrencyCode: 'USD', MonetaryValue: amount },
  ...(negotiated ? { NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: negotiated } } } : {}),
})

const REQUEST = {
  fromZip: '33312',
  toAddress: { street1: '1 Test St', city: 'Testville', state: 'ga', zip: '30005', residential: false },
  parcels: [{ weightLb: 50, lengthIn: 17.5, widthIn: 11.5, heightIn: 10 }, { weightLb: 4.25 }],
}

test('a quote: signs in, asks once, and returns the Ground rate in cents', async () => {
  const ups = fakeUps(TOKEN_OK, rated(shipment('01', '98.10'), shipment('03', '23.47'), shipment('02', '61.00')))
  const result = await quoteUps(REQUEST, ups.config)
  assert.deepEqual(result, { ok: true, rates: [{ serviceCode: '03', serviceName: 'UPS Ground', rateCents: 2347, currency: 'USD' }] })

  const [signIn, rate] = ups.calls
  assert.equal(signIn.url, 'https://ups.example/security/v1/oauth/token')
  assert.equal(signIn.method, 'POST')
  assert.equal(signIn.headers.Authorization, `Basic ${Buffer.from(`test-client-id:${SECRET}`).toString('base64')}`)
  assert.equal(signIn.headers['x-merchant-id'], 'A1B2C3')
  assert.equal(signIn.body, 'grant_type=client_credentials')

  assert.equal(rate.url, 'https://ups.example/api/rating/v2409/Shop')
  assert.equal(rate.headers.Authorization, `Bearer ${ACCESS}`)
  assert.match(rate.headers.transId, /^[0-9a-f]{32}$/)
  assert.deepEqual(JSON.parse(rate.body), {
    RateRequest: {
      Request: { TransactionReference: { CustomerContext: 'checkout rate' } },
      Shipment: {
        Shipper: { ShipperNumber: 'A1B2C3', Address: { StateProvinceCode: 'FL', PostalCode: '33312', CountryCode: 'US' } },
        ShipFrom: { Address: { StateProvinceCode: 'FL', PostalCode: '33312', CountryCode: 'US' } },
        ShipTo: { Address: { AddressLine: ['1 Test St'], City: 'Testville', StateProvinceCode: 'GA', PostalCode: '30005', CountryCode: 'US' } },
        PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: 'A1B2C3' } }] },
        NumOfPieces: '2',
        Package: [
          {
            PackagingType: { Code: '02', Description: 'Package' },
            Dimensions: { UnitOfMeasurement: { Code: 'IN', Description: 'Inches' }, Length: '18', Width: '12', Height: '10' },
            PackageWeight: { UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' }, Weight: '50.0' },
          },
          { PackagingType: { Code: '02', Description: 'Package' }, PackageWeight: { UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' }, Weight: '4.3' } },
        ],
      },
    },
  })
})

test('an address is taken to be a home unless we are told it is a business', () => {
  const config = fakeUps().config
  const home = buildRateRequest({ ...REQUEST, toAddress: { zip: '30005' } }, config)
  assert.equal(home.RateRequest.Shipment.ShipTo.Address.ResidentialAddressIndicator, 'Y')
  assert.deepEqual(Object.keys(home.RateRequest.Shipment.ShipTo.Address), ['PostalCode', 'CountryCode', 'ResidentialAddressIndicator'])
  const business = buildRateRequest(REQUEST, config)
  assert.equal('ResidentialAddressIndicator' in business.RateRequest.Shipment.ShipTo.Address, false)
})

test('the sign-in is reused until shortly before it runs out', async () => {
  const ups = fakeUps(TOKEN_OK, rated(shipment('03', '10.00')), rated(shipment('03', '11.00')), TOKEN_OK, rated(shipment('03', '12.00')))
  assert.equal((await quoteUps(REQUEST, ups.config)).rates[0].rateCents, 1000)
  assert.equal((await quoteUps(REQUEST, ups.config)).rates[0].rateCents, 1100)
  assert.equal(ups.calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1)
  ups.advance(14399 * 1000) // just past the minute-early cut-off
  assert.equal((await quoteUps(REQUEST, ups.config)).rates[0].rateCents, 1200)
  assert.equal(ups.calls.filter((c) => c.url.endsWith('/oauth/token')).length, 2)
})

test('a sign-in UPS no longer accepts is replaced once, then the rate is asked again', async () => {
  const ups = fakeUps(TOKEN_OK, { status: 401, body: { response: { errors: [{ code: '250002', message: 'Invalid Authentication Information.' }] } } }, TOKEN_OK, rated(shipment('03', '15.00')))
  const result = await quoteUps(REQUEST, ups.config)
  assert.equal(result.rates[0].rateCents, 1500)
  assert.equal(ups.calls.length, 4)

  const twice = fakeUps(TOKEN_OK, { status: 401, body: {} }, TOKEN_OK, { status: 401, body: {} })
  const failed = await quoteUps(REQUEST, twice.config)
  assert.deepEqual([failed.ok, failed.retryable], [false, false])
  assert.equal(twice.calls.length, 4)
})

test('negotiated rates are asked for and used only when the store chooses them', async () => {
  const published = fakeUps(TOKEN_OK, rated(shipment('03', '23.47', '17.20')))
  assert.equal((await quoteUps(REQUEST, published.config)).rates[0].rateCents, 2347)
  assert.equal('ShipmentRatingOptions' in JSON.parse(published.calls[1].body).RateRequest.Shipment, false)

  const negotiated = fakeUps(TOKEN_OK, rated(shipment('03', '23.47', '17.20')))
  negotiated.config.charge = 'negotiated'
  assert.equal((await quoteUps(REQUEST, negotiated.config)).rates[0].rateCents, 1720)
  assert.deepEqual(JSON.parse(negotiated.calls[1].body).RateRequest.Shipment.ShipmentRatingOptions, { NegotiatedRatesIndicator: 'Y' })

  // Asked for, but UPS gave none: the list rate, never zero.
  assert.equal(readRates(rated(shipment('03', '23.47')).body, { serviceCodes: ['03'], charge: 'negotiated' })[0].rateCents, 2347)
})

test('several services can be offered, cheapest first; unreadable amounts are dropped', () => {
  const body = rated(shipment('02', '61.00'), shipment('03', '23.47'), shipment('12', 'free'), shipment('01', '0.00')).body
  assert.deepEqual(readRates(body, { serviceCodes: ['01', '02', '03', '12'], charge: 'published' }).map((r) => [r.serviceCode, r.rateCents]), [['03', 2347], ['02', 6100]])
  // Older UPS versions answer with one shipment as an object rather than a list.
  assert.equal(readRates({ RateResponse: { RatedShipment: shipment('03', '9.5') } }, { serviceCodes: ['03'], charge: 'published' })[0].rateCents, 950)
  assert.deepEqual(readRates({}, { serviceCodes: ['03'], charge: 'published' }), [])
})

test('UPS rejecting the address tells the customer to check it; it is not retried', async () => {
  const ups = fakeUps(TOKEN_OK, { status: 400, body: { response: { errors: [{ code: '111286', message: 'ZZ is not a valid state for the specified shipment.' }] } } })
  const result = await quoteUps(REQUEST, ups.config)
  assert.deepEqual([result.ok, result.retryable], [false, false])
  assert.match(result.error, /check the address/)
  assert.match(result.detail, /111286 ZZ is not a valid state/)
  assert.equal(ups.calls.length, 2)
})

test('no rate for the services we offer is an address problem, not a zero charge', async () => {
  const result = await quoteUps(REQUEST, fakeUps(TOKEN_OK, rated(shipment('01', '98.10'))).config)
  assert.deepEqual([result.ok, result.retryable], [false, false])
})

test('UPS being down or slow can be tried again', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  for (const answers of [[timeout], [TOKEN_OK, timeout], [TOKEN_OK, { status: 503, body: 'down' }], [TOKEN_OK, { status: 429, body: {} }], [{ status: 500, body: {} }], [TOKEN_OK, { status: 200, body: 'not json' }]]) {
    const result = await quoteUps(REQUEST, fakeUps(...answers).config)
    assert.deepEqual([result.ok, result.retryable], [false, true], JSON.stringify(answers))
    assert.match(result.error, /try again/)
  }
})

test('wrong credentials are a set-up fault, and the secret never appears in a result', async () => {
  const ups = fakeUps({ status: 401, body: { response: { errors: [{ code: '10401', message: 'ClientId is Invalid' }] } } })
  const result = await quoteUps(REQUEST, ups.config)
  assert.deepEqual([result.ok, result.retryable], [false, false])
  assert.match(result.detail, /sign-in failed/)
  assert.equal(JSON.stringify(result).includes(SECRET), false)
  assert.equal(ups.calls.length, 1)
})

test('a request that cannot be rated is refused before anything is sent', async () => {
  for (const bad of [{ fromZip: '' }, { toAddress: { zip: 'ABCDE' } }, { parcels: [] }, { parcels: [{ weightLb: 0 }] }]) {
    const ups = fakeUps()
    const result = await quoteUps({ ...REQUEST, ...bad }, ups.config)
    assert.equal(result.ok, false)
    assert.equal(ups.calls.length, 0)
  }
})

test('settings: three credentials are required; Ground, list rates and the live system are the defaults', () => {
  assert.throws(() => upsConfigFromEnv({}), UpsNotConfigured)
  assert.throws(() => upsConfigFromEnv({ UPS_CLIENT_ID: 'a', UPS_CLIENT_SECRET: 'b' }), UpsNotConfigured)
  const base = { UPS_CLIENT_ID: 'a', UPS_CLIENT_SECRET: 'b', UPS_ACCOUNT_NUMBER: 'c' }
  assert.deepEqual(upsConfigFromEnv(base), { clientId: 'a', clientSecret: 'b', accountNumber: 'c', baseUrl: 'https://onlinetools.ups.com', shipFromState: 'FL', shipFromCity: null, serviceCodes: ['03'], charge: 'published' })
  const custom = upsConfigFromEnv({ ...base, UPS_ENVIRONMENT: 'test', UPS_SERVICES: '03, 02', UPS_RATES: 'negotiated', UPS_SHIP_FROM_CITY: 'Testville', UPS_SHIP_FROM_STATE: 'GA' })
  assert.deepEqual([custom.baseUrl, custom.serviceCodes, custom.charge, custom.shipFromCity, custom.shipFromState], ['https://wwwcie.ups.com', ['03', '02'], 'negotiated', 'Testville', 'GA'])
})
