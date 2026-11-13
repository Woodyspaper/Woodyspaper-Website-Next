/*
 * Turns the store's cart items into the lines the cart drawer shows. Kept
 * apart from cart.ts, with no imports, so the tests can run it directly.
 */

/** One line of the cart as the site shows it. */
export type CartLine = {
  /** Product id. */
  id: number
  name: string
  sku: string
  /** The buyer's choices by option name, e.g. { UOM: 'CASE' }. */
  options: Record<string, string>
  quantity: number
  /** Price of one, formatted; '' when unknown. */
  price: string
  /** Price of the whole line, formatted; '' when unknown. */
  lineTotal: string
  /** Small photo, or ''. */
  image: string
}

type CartItem = {
  quantity: number
  options?: Record<string, string> | null
  product: {
    id: number
    name?: string
    sku?: string
    price?: number
    mediaItem?: Record<string, unknown> | null
  }
}

/** The store names its photo sizes differently between versions: take the smallest picture it offers. */
function photo(media: Record<string, unknown> | null | undefined): string {
  if (!media) return ''
  const urls = Object.entries(media).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && /^https:\/\/.+\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(entry[1]),
  )
  const sized = (name: string) => Number(/(\d+)px/.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER)
  urls.sort((a, b) => sized(a[0]) - sized(b[0]))
  // The very smallest (tens of pixels) is too coarse for a 64px thumbnail.
  return (urls.find(([name]) => sized(name) >= 160) ?? urls[0])?.[1] ?? ''
}

export function toCartLines(items: CartItem[], money: (amount: number) => string): CartLine[] {
  return items.map((item) => {
    const price = item.product.price
    return {
      id: item.product.id,
      name: item.product.name ?? 'Product',
      sku: (item.product.sku ?? '').replace(/\s*-\s*Base$/i, ''),
      options: Object.fromEntries(Object.entries(item.options ?? {}).filter(([, value]) => typeof value === 'string' && value)),
      quantity: item.quantity,
      price: typeof price === 'number' ? money(price) : '',
      lineTotal: typeof price === 'number' ? money(price * item.quantity) : '',
      image: photo(item.product.mediaItem),
    }
  })
}
