import { json, route } from '@/server/http'
import { getStoreAccount, ssoConfigured } from '@/server/lightspeed'
import { requireUser } from '@/server/sessions'

/** Everything the account page shows. */
export const GET = route(async () => {
  const user = await requireUser()
  const store = user.emailVerified ? await getStoreAccount(user) : null
  return json({
    user: { name: user.name, email: user.email, emailVerified: user.emailVerified },
    store: store && {
      method: store.method,
      email: store.email,
      name: store.customer?.name ?? null,
      pricingGroup: store.customer?.groupName ?? null,
      /** False when Lightspeed couldn't be reached, or hasn't created the customer yet. */
      found: store.customer !== null,
    },
    canCreateStoreAccount: ssoConfigured(),
  })
})
