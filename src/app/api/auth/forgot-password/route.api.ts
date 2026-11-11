import { requestPasswordReset } from '@/server/accounts'
import { clientIp, json, need, readBody, route } from '@/server/http'
import { checkEmail } from '@/server/validation'

/** Email a reset code. Always answers the same, whether or not the account exists. */
export const POST = route(async (request) => {
  const email = need(checkEmail((await readBody(request)).email))
  await requestPasswordReset(email, clientIp(request))
  return json({ ok: true })
})
