import { hasMatchedCustomer } from '@/server/customers'
import { json, route } from '@/server/http'
import { getStoreLink } from '@/server/lightspeed'
import { currentUser } from '@/server/sessions'

/** Who is signed in, for the header and the store page. `user` is null when nobody is. */
export const GET = route(async () => {
  const user = await currentUser()
  if (!user) return json({ user: null })
  const [store, hasCustomerPricing] = await Promise.all([getStoreLink(user), user.emailVerified ? hasMatchedCustomer(user.id) : false])
  return json({
    user: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      storeSso: store.sso,
      storeMethod: store.method,
      storeEmail: store.email,
      /** Matched to one of our customers, so /api/prices answers with their own prices. */
      hasCustomerPricing,
    },
  })
})
