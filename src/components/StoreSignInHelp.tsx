'use client'

import Link from 'next/link'
import { ACCOUNT_PAGE, useAccount } from '@/services/account'
import { useStoreCustomer } from '@/services/storeCustomer'

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

/**
 * Shown above the store's account page when someone who is signed in to the
 * website arrives there and finds the store saying "You are not signed in".
 *
 * The store keeps its own sign-in (an emailed code), separate from the
 * website account, and that is confusing without a word of explanation. This
 * says which email to use, or sends them to link a store account first.
 * It shows nothing when the website signs them in to the store by itself, or
 * once they are signed in to the store.
 */
export function StoreSignInHelp() {
  const account = useAccount()
  const storeCustomer = useStoreCustomer()

  if (!account || storeCustomer || account.storeSso) return null

  return (
    <p aria-live="polite" className="mb-6 rounded-card bg-brand-mist px-5 py-4 text-sm leading-relaxed text-ink">
      You&rsquo;re signed in to the website as <strong>{account.name}</strong>. Your orders and saved addresses are kept
      in the store, which has its own sign-in.{' '}
      {account.storeMethod === 'linked' && account.storeEmail ? (
        <>
          Enter <strong>{account.storeEmail}</strong> below and the store will email you a one-time code.
        </>
      ) : (
        <>
          If you&rsquo;ve ordered from us before,{' '}
          <Link href={ACCOUNT_PAGE} className={linkClasses}>
            link your store account
          </Link>{' '}
          on your account page first. New here? You can simply shop: the store sets up an account when you check out.
        </>
      )}
    </p>
  )
}
