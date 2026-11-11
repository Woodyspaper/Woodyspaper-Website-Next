import { resetPassword } from '@/server/accounts'
import { clientIp, json, need, readBody, route } from '@/server/http'
import { startSession } from '@/server/sessions'
import { checkCode, checkEmail, checkPassword } from '@/server/validation'

/** Set a new password with the emailed code, then sign in. */
export const POST = route(async (request) => {
  const body = await readBody(request)
  const email = need(checkEmail(body.email))
  const code = need(checkCode(body.code))
  const password = need(checkPassword(body.password))
  const userId = await resetPassword(email, code, password, clientIp(request))
  await startSession(userId)
  return json({ ok: true })
})
