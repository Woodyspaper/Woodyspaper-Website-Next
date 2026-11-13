'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { addToCart } from '@/services/cart'
import { catalogEnabled, findVariation, loadProduct } from '@/services/catalog'
import type { ProductDetail } from '@/services/catalog'
import { STORE_PATH, listHref } from '@/services/storeRoutes'
import { AddedTick, useAddedFlash } from './AddedTick'
import { LoadError, Skeleton } from './Skeleton'

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

const MAX_QUANTITY = 999

/**
 * The store's description is HTML written in Lightspeed's admin. Before it
 * goes on the page, anything that could run or load something is taken out:
 * scripts, frames, forms, inline event handlers and javascript: links.
 */
function cleanHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('script, style, iframe, object, embed, form, link, meta, base').forEach((node) => node.remove())
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      const risky = name.startsWith('on') || name === 'style' || name === 'srcdoc'
      const scripted = (name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(attribute.value)
      if (risky || scripted) node.removeAttribute(attribute.name)
    }
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer')
      node.setAttribute('target', '_blank')
    }
  })
  return document.body.innerHTML
}

/** The choices to start with: the first version in stock, so most buyers can add to the cart straight away. */
function firstChoices(product: ProductDetail): Record<string, string> {
  const start = product.variations.find((variation) => variation.inStock) ?? product.variations[0]
  const chosen: Record<string, string> = { ...start?.options }
  for (const option of product.options) {
    if (!chosen[option.name] && option.choices.length === 1) chosen[option.name] = option.choices[0]
  }
  return chosen
}

/**
 * A product's own page (/product?id=…): photos, description, the choices it
 * is sold in (each or case, color…) with the price and stock of each, and
 * Add to cart.
 *
 * One page serves every product: the id is read from the address in the
 * browser, so the site doesn't need rebuilding when the catalog changes.
 * Reads the address with useSearchParams, so render it inside <Suspense>.
 */
export function ProductView() {
  const idText = useSearchParams().get('id') ?? ''
  const id = /^\d{1,12}$/.test(idText) ? Number(idText) : 0

  /** undefined while loading; null when there is no such product. */
  const [loaded, setLoaded] = useState<{ id: number; product: ProductDetail | null } | null>(null)
  // Moving from one product to another: the earlier one counts as not loaded.
  const product = loaded?.id === id ? loaded.product : undefined
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [photo, setPhoto] = useState(0)
  const [quantity, setQuantity] = useState(1)
  /** The product is on its way into the cart. */
  const [busy, setBusy] = useState(false)
  const [added, flashAdded] = useAddedFlash()
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!id || !catalogEnabled) return
    const controller = new AbortController()
    loadProduct(id, controller.signal)
      .then((found) => {
        setLoaded({ id, product: found })
        setFailed(false)
        setChosen(found ? firstChoices(found) : {})
        setPhoto(0)
        setQuantity(1)
        setProblem('')
        document.title = found ? `${found.name} | Woody's Paper` : "Product not found | Woody's Paper"
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFailed(true)
      })
    return () => controller.abort()
  }, [id, attempt])

  const description = useMemo(() => (product?.descriptionHtml ? cleanHtml(product.descriptionHtml) : ''), [product])

  if (!id || product === null || !catalogEnabled) {
    return (
      <section className="px-4 py-20 text-center">
        <h1 className="text-3xl font-bold text-slate-900">We couldn&rsquo;t find that product</h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
          It may have been discontinued or the link may be out of date.{' '}
          <Link href={STORE_PATH} className={linkClasses}>
            Browse all products
          </Link>{' '}
          or call (754) 701-1797.
        </p>
      </section>
    )
  }

  if (failed) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-20">
        <LoadError onRetry={() => { setFailed(false); setAttempt((count) => count + 1) }}>
          We couldn&rsquo;t load this product just now. Try again, or call (754) 701-1797 for pricing and availability.
        </LoadError>
      </section>
    )
  }

  if (!product) {
    return (
      <section role="status" aria-label="Loading the product" className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-2 lg:py-14">
        <Skeleton className="aspect-square rounded-panel" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-14 w-full rounded-card" />
        </div>
      </section>
    )
  }

  const variation = findVariation(product, chosen)
  const hasVariations = product.variations.length > 0
  const price = (hasVariations ? variation?.price : product.price) || product.price
  const inStock = hasVariations ? Boolean(variation?.inStock) : product.inStock
  const sku = variation?.sku || product.sku
  const stockLeft = variation?.quantity ?? null
  const maxQuantity = stockLeft !== null && stockLeft > 0 ? Math.min(stockLeft, MAX_QUANTITY) : MAX_QUANTITY
  const complete = !hasVariations || Boolean(variation)
  const buyable = complete && inStock && Boolean(price)
  /** The chosen version exists but there is none to sell: the button says so, in red, and can't be pressed. */
  const outOfStock = complete && !inStock
  const images = variation?.image ? [variation.image, ...product.images.filter((image) => image !== variation.image)] : product.images
  const shownPhoto = images[Math.min(photo, Math.max(0, images.length - 1))] ?? '/product-placeholder.webp'

  /** A choice is offered only if some version sold has it together with the choices already made for the other options. */
  const available = (optionName: string, choice: string) =>
    !hasVariations ||
    product.variations.some(
      (entry) =>
        (entry.options[optionName] ?? choice) === choice &&
        Object.entries(chosen).every(([name, value]) => name === optionName || (entry.options[name] ?? value) === value),
    )

  const choose = (optionName: string, choice: string) => {
    setChosen((current) => ({ ...current, [optionName]: choice }))
    setPhoto(0)
    setQuantity(1)
    setProblem('')
  }

  const add = async () => {
    setBusy(true)
    setProblem('')
    const options = Object.fromEntries(product.options.map((option) => [option.name, chosen[option.name]]).filter(([, value]) => value))
    const result = await addToCart(product.id, quantity, Object.keys(options).length ? options : undefined)
    setBusy(false)
    if (result.ok) flashAdded()
    else setProblem(result.message)
  }

  return (
    <section className="px-4 py-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-slate-500">
          <Link href={STORE_PATH} className="font-semibold text-brand-blue hover:underline">
            All products
          </Link>
          {product.brand ? (
            <>
              <span className="mx-2" aria-hidden="true">/</span>
              <Link href={listHref({ filters: { attribute_Brand: [product.brand] } })} className="font-semibold text-brand-blue hover:underline">
                {product.brand}
              </Link>
            </>
          ) : null}
        </nav>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <div className="overflow-hidden rounded-panel border border-slate-100 bg-white p-4 shadow-glass sm:p-8">
              {/* Store photos are served as they are, like the rest of the site. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shownPhoto} alt={product.name} className="aspect-square w-full object-contain" />
            </div>
            {images.length > 1 ? (
              <ul className="mt-4 flex flex-wrap gap-3">
                {images.map((image, index) => (
                  <li key={image}>
                    <button
                      type="button"
                      onClick={() => setPhoto(index)}
                      aria-label={`Photo ${index + 1} of ${images.length}`}
                      aria-current={index === photo ? 'true' : undefined}
                      className={`size-16 overflow-hidden rounded-2xl border bg-white p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue sm:size-20 ${
                        index === photo ? 'border-brand-blue' : 'border-slate-200 hover:border-brand-blue/40'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt="" loading="lazy" className="size-full object-contain" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            {product.brand ? <p className="font-sans text-sm font-black uppercase tracking-wider text-slate-500">{product.brand}</p> : null}
            <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">{product.name}</h1>
            {sku ? <p className="mt-2 text-sm text-slate-500">SKU {sku}</p> : null}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-3xl font-bold text-brand-blue tabular-nums">{price || 'Call for price'}</p>
              {complete ? (
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {inStock ? (stockLeft !== null && stockLeft > 0 && stockLeft <= 10 ? `Only ${stockLeft} left` : 'In stock') : 'Out of stock'}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-slate-500">List price. Your account pricing, tax and delivery are worked out in the cart.</p>

            {product.options.map((option) => (
              <fieldset key={option.name} className="mt-6">
                <legend className="mb-2 text-sm font-semibold text-slate-700">{option.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {option.choices.map((choice) => {
                    const picked = chosen[option.name] === choice
                    const offered = available(option.name, choice)
                    return (
                      <button
                        key={choice}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => choose(option.name, choice)}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${
                          picked
                            ? 'border-brand-blue bg-brand-blue text-white'
                            : offered
                              ? 'border-slate-200 bg-white text-slate-700 hover:border-brand-blue/40 hover:text-brand-blue'
                              : 'border-dashed border-slate-200 bg-white text-slate-400'
                        }`}
                      >
                        {choice}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ))}
            {hasVariations && !variation && product.options.every((option) => chosen[option.name]) ? (
              <p className="mt-3 text-sm text-slate-600">We don&rsquo;t sell that combination. Pick another.</p>
            ) : null}

            <div className="mt-8 flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Quantity</span>
                <span className="flex items-center rounded-full border border-slate-200 bg-white">
                  <button
                    type="button"
                    aria-label="One fewer"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                    className="size-11 rounded-full text-lg font-bold text-brand-blue disabled:text-slate-300"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxQuantity}
                    value={quantity}
                    onChange={(event) => {
                      const value = Math.floor(Number(event.target.value))
                      setQuantity(Number.isFinite(value) ? Math.min(maxQuantity, Math.max(1, value)) : 1)
                    }}
                    className="w-14 bg-transparent text-center text-base font-semibold text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label="One more"
                    disabled={quantity >= maxQuantity}
                    onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))}
                    className="size-11 rounded-full text-lg font-bold text-brand-blue disabled:text-slate-300"
                  >
                    +
                  </button>
                </span>
              </label>
              <button
                type="button"
                disabled={!buyable || busy}
                onClick={() => void add()}
                className={`min-w-44 rounded-full px-8 py-3.5 text-base font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed ${
                  outOfStock
                    ? 'bg-red-600 opacity-50'
                    : added
                      ? 'bg-emerald-600 shadow-cta'
                      : 'bg-brand-blue shadow-cta hover:bg-brand-blue-dark active:scale-95 disabled:opacity-50 disabled:hover:bg-brand-blue'
                }`}
              >
                {outOfStock ? 'Out of stock' : added ? <AddedTick /> : busy ? 'Adding…' : 'Add to cart'}
              </button>
            </div>
            {problem ? (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
                {problem}
              </p>
            ) : null}
            {!buyable && complete ? (
              <p className="mt-3 text-sm text-slate-600">
                {outOfStock ? 'This one is out of stock.' : 'This product has no online price.'} Call (754) 701-1797 and we&rsquo;ll help.
              </p>
            ) : null}

            {description ? (
              <div className="mt-10 border-t border-slate-100 pt-8">
                <h2 className="font-sans text-sm font-black uppercase tracking-wider text-slate-500">Description</h2>
                {/* Cleaned by cleanHtml above. */}
                <div
                  className="mt-3 space-y-3 text-base leading-relaxed text-slate-700 [&_a]:font-semibold [&_a]:text-brand-blue [&_a]:underline [&_li]:ml-5 [&_li]:list-disc"
                  dangerouslySetInnerHTML={{ __html: description }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
