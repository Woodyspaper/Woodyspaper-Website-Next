import { signIn } from '@/server/accounts'
import { clientIp, json, need, readBody, route } from '@/server/http'
import { startSession } from '@/server/sessions'
import { checkEmail } from '@/server/validation'

export const POST = route(async (request) => {
  const body = await readBody(request)
  const email = need(checkEmail(body.email))
  const password = typeof body.password === 'string' ? body.password.slice(0, 1000) : ''
  const userId = await signIn(email, password, clientIp(request))
  await startSession(userId)
  return json({ ok: true })
})
