import { signUp } from '@/server/accounts'
import { clientIp, json, need, readBody, route } from '@/server/http'
import { startSession } from '@/server/sessions'
import { checkEmail, checkName, checkPassword } from '@/server/validation'

/** Create an account. Signs the visitor in; their email still needs confirming. */
export const POST = route(async (request) => {
  const body = await readBody(request)
  const name = need(checkName(body.name))
  const email = need(checkEmail(body.email))
  const password = need(checkPassword(body.password))
  const userId = await signUp(name, email, password, clientIp(request))
  await startSession(userId)
  return json({ ok: true }, 201)
})
