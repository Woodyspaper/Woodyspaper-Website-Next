import { json, route } from '@/server/http'
import { getSsoPayload } from '@/server/lightspeed'
import { currentUser } from '@/server/sessions'

/** The store sign-on string for this visitor; null unless their store account uses single sign-on. */
export const GET = route(async () => {
  const user = await currentUser()
  return json({ payload: user ? await getSsoPayload(user) : null })
})
