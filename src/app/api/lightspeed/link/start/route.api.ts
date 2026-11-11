import { json, need, readBody, route } from '@/server/http'
import { startLink } from '@/server/lightspeed'
import { requireVerifiedUser } from '@/server/sessions'
import { checkEmail } from '@/server/validation'

/** Begin linking a Lightspeed store account by its email address. */
export const POST = route(async (request) => {
  const user = await requireVerifiedUser()
  const email = need(checkEmail((await readBody(request)).email))
  return json(await startLink(user, email))
})
