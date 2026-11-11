import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpError, isRetryable, withRetry } from '../src/services/retry.ts'

const FAST = { delays: [1, 1] }

/** A request that fails with each given error in turn, then succeeds. */
function flaky(...errors) {
  let calls = 0
  const request = async () => {
    calls += 1
    if (calls <= errors.length) throw errors[calls - 1]
    return `ok after ${calls}`
  }
  return { request, calls: () => calls }
}

const named = (name) => Object.assign(new Error(name), { name })

test('network failures, timeouts, 429 and 5xx are worth retrying; 4xx and cancellations are not', () => {
  for (const error of [new TypeError('fetch failed'), named('TimeoutError'), new HttpError(500, ''), new HttpError(503, ''), new HttpError(429, ''), new HttpError(408, '')]) {
    assert.equal(isRetryable(error), true, error.name + ' ' + (error.status ?? ''))
  }
  for (const error of [new HttpError(400, ''), new HttpError(401, ''), new HttpError(403, ''), new HttpError(404, ''), named('AbortError'), new Error('other'), null, 'text']) {
    assert.equal(isRetryable(error), false, String(error?.name ?? error) + ' ' + (error?.status ?? ''))
  }
})

test('a success on the first try is returned without retrying', async () => {
  const { request, calls } = flaky()
  assert.equal(await withRetry(request, FAST), 'ok after 1')
  assert.equal(calls(), 1)
})

test('a passing failure is retried until it works', async () => {
  const { request, calls } = flaky(new TypeError('fetch failed'), new HttpError(503, 'busy'))
  assert.equal(await withRetry(request, FAST), 'ok after 3')
  assert.equal(calls(), 3)
})

test('after the last retry the last error is thrown', async () => {
  const { request, calls } = flaky(new HttpError(500, 'one'), new HttpError(500, 'two'), new HttpError(500, 'three'))
  await assert.rejects(withRetry(request, FAST), { message: 'three' })
  assert.equal(calls(), 3)
})

test('an error not worth retrying is thrown at once', async () => {
  const { request, calls } = flaky(new HttpError(404, 'gone'))
  await assert.rejects(withRetry(request, FAST), { message: 'gone' })
  assert.equal(calls(), 1)
})

test('a cancelled request is not retried, even mid-wait', async () => {
  const controller = new AbortController()
  const { request, calls } = flaky(new TypeError('fetch failed'), new TypeError('fetch failed'))
  const pending = withRetry(request, { delays: [50, 50], signal: controller.signal })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending)
  assert.equal(calls(), 1)
})

test('the caller can decide what is retried', async () => {
  const { request, calls } = flaky(new Error('custom'))
  assert.equal(await withRetry(request, { ...FAST, shouldRetry: (error) => error.message === 'custom' }), 'ok after 2')
  assert.equal(calls(), 2)
})
