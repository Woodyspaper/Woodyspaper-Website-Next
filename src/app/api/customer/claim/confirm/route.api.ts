import { confirmClaim } from '@/server/customers'
import { json, need, readBody, route } from '@/server/http'
import { requireVerifiedUser } from '@/server/sessions'
import { checkCode } from '@/server/validation'

/** Finish the match with the code emailed to the customer's address. */
export const POST = route(async (request) => {
  const user = await requireVerifiedUser()
  const code = need(checkCode((await readBody(request)).code))
  await confirmClaim(user, code)
  return json({ ok: true })
})
