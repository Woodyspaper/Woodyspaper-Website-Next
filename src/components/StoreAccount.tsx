'use client'

import { useRouter } from 'next/navigation'
import { openStoreAccount, signOutOfStore, useStoreCustomer } from '@/services/storeCustomer'

type StoreAccountProps = {
  /** False until the storefront API is usable. */
  ready: boolean
  /** id of the store container, scrolled to when the account page opens. */
  resultsId: string
  /** Open the account page on this URL instead of in this store (home page). */
  accountHref?: string
}

/**
 * Customer account control beside the cart. Signing in happens in the
 * Lightspeed store, which then applies the customer's group discounts.
 */
export function StoreAccount({ ready, resultsId, accountHref }: StoreAccountProps) {
  const router = useRouter()
  const customer = useStoreCustomer()
  const firstName = customer?.name?.trim().split(/\s+/)[0] || customer?.email

  const openAccount = () => {
    if (accountHref) {
      router.push(accountHref)
      return
    }
    if (!openStoreAccount()) return
    document.getElementById(resultsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2">
      {customer ? (
        <p className="max-w-48 truncate text-sm text-slate-600" title={customer.email}>
          Hi, <span className="font-semibold text-ink">{firstName}</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={openAccount}
        disabled={!ready && !accountHref}
        className="rounded-full border border-brand-blue/30 bg-white px-6 py-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95"
      >
        {customer ? 'My Account' : 'Sign In'}
      </button>
      {customer ? (
        <button
          type="button"
          onClick={signOutOfStore}
          disabled={!ready}
          className="text-sm font-semibold text-slate-500 transition-colors hover:text-brand-blue disabled:opacity-50"
        >
          Sign out
        </button>
      ) : null}
    </div>
  )
}
