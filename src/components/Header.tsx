'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from './Logo'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const onInventory = usePathname() === '/inventory'

  useEffect(() => {
    document.body.classList.toggle('overflow-hidden', menuOpen)
    return () => document.body.classList.remove('overflow-hidden')
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  return (
    <>
      <header className="fixed inset-x-0 top-utility z-50 h-header border-b border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-lg lg:h-header-lg">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
          <Logo className="h-14 lg:h-16" />

          <nav aria-label="Primary" className="hidden items-center gap-10 font-semibold text-slate-600 lg:flex">
            <Link
              href="/inventory"
              aria-current={onInventory ? 'page' : undefined}
              className={`transition-colors hover:text-brand-blue ${onInventory ? 'text-brand-blue' : ''}`}
            >
              Inventory
            </Link>
            <Link
              href="/#contact"
              className="rounded-full bg-brand-blue px-6 py-2.5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Supply Inquiry
            </Link>
          </nav>

          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-full p-2 text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="size-8" aria-hidden="true">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16m-7 6h7" />}
            </svg>
          </button>
        </div>
      </header>

      <div
        id="mobile-menu"
        hidden={!menuOpen}
        className="fixed inset-x-0 top-chrome z-40 flex flex-col gap-6 border-b border-slate-200 bg-white/98 px-6 py-8 text-center text-lg font-semibold text-slate-700 shadow-lift backdrop-blur-xl lg:hidden"
      >
        <Link href="/inventory" onClick={close} className="text-brand-blue">Inventory</Link>
        <Link href="/#contact" onClick={close}>Direct Inquiry</Link>
      </div>
    </>
  )
}
