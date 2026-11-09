'use client'

import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ACCOUNT_PATH, useStoreCustomer } from '@/services/storeCustomer'
import { Logo } from './Logo'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const onInventory = pathname === '/inventory'
  const customer = useStoreCustomer()
  // Signed in: the customer's first name (or "My Account" if the store has no name for them).
  const accountLabel = customer ? customer.name?.trim().split(/\s+/)[0] || 'My Account' : 'Sign In'
  const accountTitle = customer ? `Your account (${customer.email})` : undefined

  // Moving to another page (Back included) closes the mobile menu.
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMenuOpen(false)
  }

  // While open: lock page scrolling, and let Esc close the menu.
  useEffect(() => {
    document.body.classList.toggle('overflow-hidden', menuOpen)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('overflow-hidden')
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  /** Any link in the bar (the logo too, even to the page you're on) closes the menu. */
  const closeOnLinkClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('a')) close()
  }

  /*
   * Already on the home page, "/#contact" doesn't scroll by itself (the store
   * owns the URL's #!/ hash there), so scroll to the form directly and leave
   * the address alone. From other pages the link navigates as usual.
   */
  const goToContact = (event: MouseEvent<HTMLAnchorElement>) => {
    close()
    if (pathname !== '/') return
    const form = document.getElementById('contact')
    if (!form) return
    event.preventDefault()
    form.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <header onClickCapture={closeOnLinkClick} className="fixed inset-x-0 top-utility z-50 h-header border-b border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-lg lg:h-header-lg">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
          <Logo className="h-14 lg:h-16" />

          <nav aria-label="Primary" className="hidden items-center gap-10 font-semibold text-slate-600 lg:flex">
            <Link
              href="/#contact"
              onClick={goToContact}
              className="rounded-full bg-brand-blue px-6 py-2.5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Supply Inquiry
            </Link>
            <Link
              href="/inventory"
              aria-current={onInventory ? 'page' : undefined}
              className={`transition-colors hover:text-brand-blue ${onInventory ? 'text-brand-blue' : ''}`}
            >
              Inventory
            </Link>
            <Link
              href={ACCOUNT_PATH}
              title={accountTitle}
              className="flex max-w-40 items-center gap-2 transition-colors hover:text-brand-blue"
            >
              {customer ? (
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0 text-brand-blue" aria-hidden="true">
                  <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z" />
                </svg>
              ) : null}
              <span className="truncate">{accountLabel}</span>
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
        <Link href={ACCOUNT_PATH} onClick={close} title={accountTitle} className="inline-flex items-center justify-center gap-2">
          {customer ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0 text-brand-blue" aria-hidden="true">
              <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z" />
            </svg>
          ) : null}
          {accountLabel}
        </Link>
        <Link href="/#contact" onClick={goToContact}>Direct Inquiry</Link>
      </div>
    </>
  )
}
