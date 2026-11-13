import { startClaim } from '@/server/customers'
import { json, need, readBody, route } from '@/server/http'
import { requireVerifiedUser } from '@/server/sessions'
import { checkEmail } from '@/server/validation'

/** Begin matching this website account to a customer account, by the email we hold for the customer. */
export const POST = route(async (request) => {
  const user = await requireVerifiedUser()
  const email = need(checkEmail((await readBody(request)).email))
  return json(await startClaim(user, email))
})
