'use client'

import { Suspense, useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LOGIN_PATH, signOut, useAccount } from '@/services/account'
import { ACCOUNT_LINKS, AccountMenu, PersonIcon, accountLabel } from './AccountMenu'
import { HeaderSearch } from './HeaderSearch'
import { Logo } from './Logo'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  // The website account (not the store's own sign-in), for the mobile menu. The desktop control is AccountMenu.
  const account = useAccount()

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
   * Already on the home page, "/#contact" doesn't need a navigation: scroll to
   * the form directly and leave the address alone. From other pages the link
   * navigates as usual.
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
        {/* Mobile: logo and menu button, with the search on a second row. Desktop: one row. */}
        <div className="mx-auto flex h-full max-w-7xl flex-wrap content-center items-center justify-between gap-x-6 gap-y-2 px-4 lg:flex-nowrap lg:gap-x-8">
          <Logo className="h-11 lg:h-16" />

          <div className="order-last w-full lg:order-0 lg:max-w-xl lg:flex-1">
            {/* The search reads ?q= from the URL, which is only known in the browser. */}
            <Suspense fallback={<div className="h-11 rounded-full border border-slate-200 bg-slate-50" />}>
              <HeaderSearch />
            </Suspense>
          </div>

          <nav aria-label="Primary" className="hidden shrink-0 items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
            {/* <Link
              href="/#contact"
              onClick={goToContact}
              className="rounded-full bg-brand-blue px-5 py-2.5 font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
            >
              Supply Inquiry
            </Link> */}
            {/* Signed out: a Sign In link. Signed in: their name, opening the account dropdown. */}
            <AccountMenu />
          </nav>

          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-full p-1.5 text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue lg:hidden"
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
        {/* The same account items as the desktop dropdown, listed in place. */}
        {account ? (
          <>
            <p className="inline-flex items-center justify-center gap-2 text-base text-slate-500" title={account.email}>
              <PersonIcon />
              <span className="truncate">{accountLabel(account)}</span>
            </p>
            {ACCOUNT_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={close}>
                {link.label}
              </Link>
            ))}
          </>
        ) : (
          <Link href={LOGIN_PATH} onClick={close} className="inline-flex items-center justify-center gap-2">
            <PersonIcon />
            Sign In
          </Link>
        )}
        <Link href="/#contact" onClick={goToContact}>Direct Inquiry</Link>
        {account ? (
          <button type="button" onClick={() => void signOut()} className="font-semibold text-slate-500 transition-colors hover:text-red-600 focus-visible:text-red-600 active:text-red-700">
            Sign out
          </button>
        ) : null}
      </div>
    </>
  )
}
