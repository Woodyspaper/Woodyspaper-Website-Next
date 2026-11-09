'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { catalog } from '@/data/catalog'
import { inventory } from '@/data/inventory'
import { inventoryPath } from '@/paths'
import { ProductSearchForm } from './StoreSearch'
import { Reveal } from './Reveal'

const featured = inventory.flatMap((category) => {
  const item = catalog.find((entry) => entry.category === category.title)
  return item ? [{ category: category.title, item }] : []
})

/** A short slice of the catalog on the home page. Every action opens the hub. */
export function InventoryPreview() {
  const router = useRouter()
  const [keyword, setKeyword] = useState('')

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(inventoryPath(keyword))
  }

  return (
    <Reveal as="section" id="products" className="scroll-mt-chrome px-4 py-12 sm:py-20 lg:scroll-mt-chrome-lg">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 text-center sm:mb-12">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl">Inventory Hub</h2>
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-brand-blue sm:w-20" />
          <p className="mx-auto max-w-xl text-base text-slate-600">
            A few lines from the warehouse. Search or choose one to open it in the full hub.
          </p>
        </div>

        <ProductSearchForm
          id="home-search"
          keyword={keyword}
          onKeywordChange={setKeyword}
          onSubmit={search}
          onClear={() => setKeyword('')}
          buttonLabel="Search"
        />

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {inventory.map((category) => (
            <li key={category.title}>
              <Link
                href={inventoryPath(category.title)}
                className="flex h-full flex-col rounded-card bg-brand-mist p-6 shadow-glass transition duration-200 hover:-translate-y-1.5 hover:shadow-lift"
              >
                <p className="text-xs font-bold uppercase tracking-ultra text-brand-blue">{category.subtitle}</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">{category.title}</h3>
                <p className="mt-auto pt-6 text-sm font-semibold text-brand-blue">Open in hub</p>
              </Link>
            </li>
          ))}
        </ul>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {featured.map(({ item }) => (
            <li key={item.id}>
              <Link
                href={inventoryPath(item.description)}
                className="flex h-full items-center justify-between gap-4 rounded-card border border-slate-100 bg-white p-5 shadow-glass transition duration-200 hover:-translate-y-1 hover:border-brand-blue/30 hover:shadow-lift"
              >
                <span>
                  <span className="block text-xs font-bold uppercase tracking-ultra text-brand-blue">{item.category}</span>
                  <span className="mt-1 block font-semibold text-slate-900">{item.description}</span>
                  <span className="mt-1 block text-sm text-slate-500">{item.id} · {item.unit}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-blue">View</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center">
          <Link
            href="/inventory"
            className="inline-flex rounded-full border border-brand-blue/30 bg-white px-8 py-3.5 text-base font-semibold text-brand-blue transition-colors hover:bg-brand-mist"
          >
            Browse the full hub
          </Link>
        </p>
      </div>
    </Reveal>
  )
}
