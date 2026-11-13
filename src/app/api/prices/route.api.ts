import { ApiError, json, readBody, route } from '@/server/http'
import { MAX_PRODUCTS_PER_REQUEST, customerForUser, pricesForProducts } from '@/server/pricing/prices'
import { currentUser } from '@/server/sessions'

/**
 * Prices and stock for the products on the visitor's screen.
 *
 * Send { productIds: [Lightspeed eCom product ids] }, at most 60. The answer
 * has, per product and per version of it, the list price, this visitor's
 * price (a number and as text), where that price came from, and stock.
 *
 * Whose prices is decided by the sign-in cookie alone: the request cannot
 * name a customer. Signed-out visitors, accounts whose email isn't confirmed
 * and accounts not matched to a customer get list prices.
 */
export const POST = route(async (request) => {
  const { productIds } = await readBody(request)
  if (!Array.isArray(productIds)) throw new ApiError(400, 'Invalid request.')
  const ids = [...new Set(productIds)]
  if (ids.length > MAX_PRODUCTS_PER_REQUEST) throw new ApiError(400, 'Too many products in one request.')
  if (!ids.every((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
    throw new ApiError(400, 'Invalid request.')
  }

  const user = await currentUser()
  const customer = user?.emailVerified ? await customerForUser(user.id) : null
  return json({
    /** True when the prices below are this customer's own rather than list prices. */
    customerPricing: customer !== null,
    products: await pricesForProducts(ids, customer),
  })
})
