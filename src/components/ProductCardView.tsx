'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AddedTick, useAddedFlash } from './AddedTick'
import { addToCart } from '@/services/cart'
import type { ProductCard } from '@/services/catalog'
import { productHref } from '@/services/storeRoutes'

const buttonClasses =
  'w-full rounded-full px-4 py-2.5 text-center text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95 disabled:opacity-60'

/**
 * One product in the list: photo, name, SKU, list price and stock, linking to
 * its page. A product with nothing to choose can go straight into the cart;
 * one sold several ways (each or case, colors…) sends the buyer to its page
 * to pick.
 */
export function ProductCardView({ product }: { product: ProductCard }) {
  const [adding, setAdding] = useState(false)
  const [added, flashAdded] = useAddedFlash()
  const [problem, setProblem] = useState('')
  const href = productHref(product.id)
  const buyable = product.inStock && Boolean(product.price)

  const add = async () => {
    setAdding(true)
    setProblem('')
    const result = await addToCart(product.id, 1)
    setAdding(false)
    if (result.ok) flashAdded()
    else setProblem(result.message)
  }

  return (
    <li className="flex h-full flex-col overflow-hidden rounded-card border border-slate-100 bg-white transition-[translate,box-shadow] duration-300 ease-brand hover:-translate-y-1 hover:shadow-lift">
      <Link
        href={href}
        className="group flex flex-1 flex-col focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue"
      >
        {/* Store photos are already sized thumbnails; served as-is like the rest of the site. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image || '/product-placeholder.webp'}
          alt=""
          loading="lazy"
          className="aspect-square w-full bg-white object-contain p-3"
        />
        <span className="flex flex-1 flex-col gap-2 border-t border-slate-100 p-3 sm:p-4">
          <span className="line-clamp-3 text-xs font-semibold leading-snug text-ink transition-colors group-hover:text-brand-blue sm:text-sm">
            {product.name}
          </span>
          {product.sku ? <span className="text-xs text-slate-500">SKU {product.sku}</span> : null}
          <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
            <span className="text-base font-bold text-brand-blue tabular-nums sm:text-lg">{product.price || 'Call for price'}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-3xs font-black uppercase tracking-wider sm:text-xs sm:font-semibold sm:normal-case sm:tracking-normal ${
                product.inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {product.inStock ? 'In stock' : 'Out of stock'}
            </span>
          </span>
        </span>
      </Link>
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        {buyable && !product.hasChoices ? (
          <button
            type="button"
            onClick={() => void add()}
            disabled={adding}
            className={`${buttonClasses} text-white ${added ? 'bg-emerald-600' : 'bg-brand-blue hover:bg-brand-blue-dark'}`}
          >
            {added ? <AddedTick /> : adding ? 'Adding…' : 'Add to cart'}
          </button>
        ) : !product.inStock ? (
          // Nothing to sell: says so in red and can't be pressed. The card above still opens the product.
          <button type="button" disabled className="w-full cursor-not-allowed rounded-full bg-red-600 px-4 opacity-50 py-2.5 text-center text-sm font-semibold text-white">
            Out of stock
          </button>
        ) : (
          <Link href={href} className={`${buttonClasses} block border border-brand-blue/30 bg-white text-brand-blue hover:bg-brand-mist`}>
            {buyable ? 'Choose options' : 'View details'}
          </Link>
        )}
        {problem ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
            {problem}
          </p>
        ) : null}
      </div>
    </li>
  )
}
