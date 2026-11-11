import { consumeCode, markEmailVerified } from '@/server/accounts'
import { ApiError, json, need, readBody, route } from '@/server/http'
import { requireUser } from '@/server/sessions'
import { checkCode } from '@/server/validation'

/** Confirm the account's email with the code that was sent to it. */
export const POST = route(async (request) => {
  const user = await requireUser()
  if (user.emailVerified) return json({ ok: true })
  const code = need(checkCode((await readBody(request)).code))
  if (!(await consumeCode(user.id, 'verify', code))) {
    throw new ApiError(400, 'That code is wrong or has expired. Request a new one.')
  }
  await markEmailVerified(user.id)
  return json({ ok: true })
})
