import { json, need, readBody, route } from '@/server/http'
import { confirmLink } from '@/server/lightspeed'
import { requireVerifiedUser } from '@/server/sessions'
import { checkCode } from '@/server/validation'

/** Finish linking with the code emailed to the store account's address. */
export const POST = route(async (request) => {
  const user = await requireVerifiedUser()
  const code = need(checkCode((await readBody(request)).code))
  await confirmLink(user, code)
  return json({ ok: true })
})
