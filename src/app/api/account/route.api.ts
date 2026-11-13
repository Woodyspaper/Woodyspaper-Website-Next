import { customerForUser } from '@/server/pricing/prices'
import { json, route } from '@/server/http'
import { getStoreAccount, ssoConfigured } from '@/server/lightspeed'
import { requireUser } from '@/server/sessions'

/** Everything the account page shows. */
export const GET = route(async () => {
  const user = await requireUser()
  const [store, customer] = user.emailVerified ? await Promise.all([getStoreAccount(user), customerForUser(user.id)]) : [null, null]
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
    /** The customer account (our own customer list) this website account is matched to; null when it isn't. */
    customer: customer && {
      companyName: customer.companyName,
      name: customer.name,
      pricingGroup: customer.groupName,
    },
    canCreateStoreAccount: ssoConfigured(),
  })
})
