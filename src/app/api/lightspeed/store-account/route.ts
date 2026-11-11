import { json, route } from '@/server/http'
import { createStoreAccount } from '@/server/lightspeed'
import { requireVerifiedUser } from '@/server/sessions'

/** For customers new to the store: set up a store account that the website signs in to. */
export const POST = route(async () => {
  const user = await requireVerifiedUser()
  return json({ method: await createStoreAccount(user) })
})
