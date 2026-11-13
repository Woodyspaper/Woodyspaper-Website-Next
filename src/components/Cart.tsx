'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { removeFromCart, setCartOpen, setCartQuantity, startCart, useCart } from '@/services/cart'
import type { CartLine } from '@/services/cart'
import { CHECKOUT_PATH, STORE_PATH, productHref } from '@/services/storeRoutes'

/** How long after the page loads the store script is fetched, so it never competes with the page itself. */
const START_DELAY_MS = 1500

/**
 * The cart button in the header: a bag with the number of items, opening the
 * cart drawer. Also starts the cart (services/cart.ts) shortly after the page
 * loads, on every page.
 */
export function CartButton({ className = '' }: { className?: string }) {
  const cart = useCart()

  useEffect(() => {
    const timer = window.setTimeout(startCart, START_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <button
      type="button"
      onClick={() => {
        startCart()
        setCartOpen(true)
      }}
      aria-label={cart.count ? `Cart, ${cart.count} ${cart.count === 1 ? 'item' : 'items'}` : 'Cart, empty'}
      aria-haspopup="dialog"
      className={`relative rounded-full p-2 text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-7" aria-hidden="true">
        <path d="M6 8h12l1 12H5L6 8z" />
        <path d="M9 8V7a3 3 0 016 0v1" />
      </svg>
      {cart.count > 0 ? (
        // Keyed by the count, so the badge is drawn afresh, and pops, each time the number changes.
        <span
          key={cart.count}
          className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-blue px-1 text-xs font-bold text-white ring-2 ring-white tabular-nums motion-safe:animate-cart-pop motion-reduce:animate-cart-flash"
        >
          {cart.count > 99 ? '99+' : cart.count}
        </span>
      ) : null}
    </button>
  )
}

function Line({ line, index, onClose }: { line: CartLine; index: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const choices = Object.values(line.options).join(' · ')

  const change = async (quantity: number) => {
    setBusy(true)
    setProblem('')
    const result = await setCartQuantity(index, quantity)
    setBusy(false)
    if (!result.ok) setProblem(result.message)
  }

  return (
    <li className={`flex gap-4 py-4 transition-opacity ${busy ? 'opacity-50' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={line.image || '/product-placeholder.webp'} alt="" className="size-16 shrink-0 rounded-2xl border border-slate-100 bg-white object-contain p-1" />
      <div className="min-w-0 flex-1">
        <Link href={productHref(line.id)} onClick={onClose} className="line-clamp-2 text-sm font-semibold leading-snug text-ink hover:text-brand-blue">
          {line.name}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {[line.sku ? `SKU ${line.sku}` : '', choices].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center rounded-full border border-slate-200">
            <button
              type="button"
              aria-label={line.quantity > 1 ? 'One fewer' : 'Remove'}
              disabled={busy}
              onClick={() => void change(line.quantity - 1)}
              className="size-8 rounded-full text-base font-bold text-brand-blue"
            >
              −
            </button>
            <span className="min-w-8 text-center text-sm font-semibold text-ink tabular-nums" aria-label={`Quantity ${line.quantity}`}>
              {line.quantity}
            </span>
            <button type="button" aria-label="One more" disabled={busy} onClick={() => void change(line.quantity + 1)} className="size-8 rounded-full text-base font-bold text-brand-blue">
              +
            </button>
          </span>
          <span className="text-sm font-bold text-ink tabular-nums">{line.lineTotal}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          {line.quantity > 1 && line.price ? <span className="text-xs text-slate-500">{line.price} each</span> : <span />}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void removeFromCart(index).finally(() => setBusy(false))
            }}
            aria-label={`Remove ${line.name} from the cart`}
            title="Remove"
            className="rounded-full p-2 text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-red-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
              <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        </div>
        {problem ? (
          <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
            {problem}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The cart, sliding in from the right: what's in it, with quantities that can
 * be changed, the running total, and the way on to checkout. Rendered once,
 * by the header; opened by the cart button.
 */
export function CartDrawer() {
  const cart = useCart()
  const pathname = usePathname()
  const panel = useRef<HTMLDivElement>(null)
  const close = () => setCartOpen(false)

  // Moving to another page (Back included) closes the drawer.
  useEffect(() => setCartOpen(false), [pathname])

  // While open: lock page scrolling, let Esc close it, and move focus into it.
  useEffect(() => {
    if (!cart.open) return
    document.body.classList.add('overflow-hidden')
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCartOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('overflow-hidden')
      document.removeEventListener('keydown', onKey)
    }
  }, [cart.open])

  if (!cart.open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close cart" onClick={close} className="absolute inset-0 size-full cursor-default bg-ink/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-panel outline-none"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-xl font-bold text-slate-900">
            Your cart{cart.count ? <span className="ml-2 font-sans text-sm font-semibold text-slate-500">({cart.count})</span> : null}
          </h2>
          <button type="button" onClick={close} aria-label="Close cart" className="rounded-full p-2 text-slate-500 hover:bg-brand-mist hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-brand-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="size-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {cart.failed && !cart.loaded ? (
          <div className="flex-1 p-6 text-center">
            <p className="text-base font-semibold text-ink">The cart didn&rsquo;t load.</p>
            <p className="mt-2 text-sm text-slate-600">
              A browser extension may be blocking it, or it&rsquo;s briefly unavailable. Try again, or call (754) 701-1797 to order.
            </p>
            <button
              type="button"
              onClick={startCart}
              className="mt-4 rounded-full border border-brand-blue/30 bg-white px-6 py-2.5 text-sm font-semibold text-brand-blue hover:bg-brand-mist"
            >
              Try again
            </button>
          </div>
        ) : !cart.loaded ? (
          <p role="status" className="flex-1 p-6 text-center text-sm text-slate-500">
            Loading your cart…
          </p>
        ) : cart.lines.length === 0 ? (
          <div className="flex-1 p-6 text-center">
            <p className="text-base font-semibold text-ink">Your cart is empty.</p>
            <Link href={STORE_PATH} onClick={close} className="mt-4 inline-block rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white hover:bg-brand-blue-dark">
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto px-5">
              {cart.lines.map((line, index) => (
                <Line key={`${line.id}-${JSON.stringify(line.options)}`} line={line} index={index} onClose={close} />
              ))}
            </ul>
            <div className="border-t border-slate-100 px-5 py-5">
              {cart.discount ? (
                <p className="mb-1 flex justify-between text-sm text-emerald-700">
                  <span>Your account savings</span>
                  <span className="font-semibold tabular-nums">−{cart.discount}</span>
                </p>
              ) : null}
              <p className="flex justify-between text-base font-bold text-ink">
                <span>Subtotal</span>
                <span className="tabular-nums">{cart.subtotal || '…'}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Tax and delivery are added at checkout.</p>
              {/* A plain link (full page load) on purpose: the checkout is Lightspeed's and starts fresh on its own page. */}
              <a
                href={CHECKOUT_PATH}
                className="mt-4 block rounded-full bg-brand-blue px-8 py-3.5 text-center text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
              >
                Checkout
              </a>
              <button type="button" onClick={close} className="mt-3 w-full text-center text-sm font-semibold text-brand-blue hover:underline">
                Keep shopping
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
