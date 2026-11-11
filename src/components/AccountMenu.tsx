'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ACCOUNT_PAGE, LOGIN_PATH, signOut, useAccount } from '@/services/account'
import type { Account } from '@/services/account'
import { ACCOUNT_PATH as STORE_ACCOUNT_PATH } from '@/services/storeCustomer'
import { Skeleton } from './Skeleton'

export function PersonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-4.5 shrink-0 text-brand-blue" aria-hidden="true">
      <circle cx="10" cy="6.5" r="3.25" />
      <path d="M3.5 17a6.5 6.5 0 0113 0" />
    </svg>
  )
}

/** First name for the header, or "My Account" if the account has no usable name. */
export const accountLabel = (account: Account) => account.name.trim().split(/\s+/)[0] || 'My Account'

/**
 * Where a signed-in customer can go from the header. Shared by the desktop
 * dropdown and the mobile menu; add new account pages here.
 *
 * Orders live in the Lightspeed store. Someone with no store account yet
 * would only find a "not signed in" page there, so they are offered the
 * linking step on the account page instead.
 */
export function accountLinks(account: Account): { href: string; label: string }[] {
  return [
    { href: ACCOUNT_PAGE, label: 'Account settings' },
    account.storeMethod
      ? // The store's own account page: order history and saved addresses.
        { href: STORE_ACCOUNT_PATH, label: 'Orders & store account' }
      : { href: `${ACCOUNT_PAGE}#store-account`, label: 'Link store account' },
  ]
}

const itemClasses =
  'block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-brand-mist hover:text-brand-blue focus-visible:bg-brand-mist focus-visible:text-brand-blue focus-visible:outline-none'

/** Sign out turns red on hover, keyboard focus and while pressed, so it reads as the way out. */
const signOutClasses =
  'block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600 focus-visible:outline-none active:bg-red-100 active:text-red-700'

/**
 * The account control in the desktop header. Signed out it is a "Sign In"
 * link; signed in it is the customer's first name, which opens a menu with
 * their account links and "Sign out".
 */
export function AccountMenu() {
  // undefined until the server has answered who is signed in.
  const account = useAccount()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Moving to another page closes the menu.
  const [openPath, setOpenPath] = useState(pathname)
  if (openPath !== pathname) {
    setOpenPath(pathname)
    setOpen(false)
  }

  // While open: a click anywhere else or Esc closes it.
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Not known yet: a placeholder, so "Sign In" doesn't flash up for someone who is signed in.
  if (account === undefined) {
    return (
      <span role="status" aria-label="Checking your account" className="flex items-center gap-2">
        <PersonIcon />
        <Skeleton className="h-4 w-16" />
      </span>
    )
  }

  if (!account) {
    return (
      <Link href={LOGIN_PATH} className="flex max-w-40 items-center gap-2 transition-colors hover:text-brand-blue">
        <PersonIcon />
        <span className="truncate">Sign In</span>
      </Link>
    )
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-44 items-center gap-2 rounded-full py-1.5 transition-colors hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-blue"
      >
        <PersonIcon />
        <span className="truncate">{accountLabel(account)}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="Your account"
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-3 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lift"
      >
        <div className="border-b border-slate-100 px-3 pb-3 pt-2">
          <p className="truncate text-sm font-bold text-ink">{account.name}</p>
          <p className="truncate text-xs font-normal text-slate-500" title={account.email}>
            {account.email}
          </p>
        </div>
        <div className="py-2">
          {accountLinks(account).map((link) => (
            <Link key={link.href} href={link.href} role="menuitem" onClick={() => setOpen(false)} className={itemClasses}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-2">
          <button type="button" role="menuitem" onClick={() => void signOut()} className={signOutClasses}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
