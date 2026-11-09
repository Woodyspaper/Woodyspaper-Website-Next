'use client'

import Link from 'next/link'
import { ACCOUNT_PATH, useStoreCustomer } from '@/services/storeCustomer'

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

/**
 * One line under the Inventory Hub heading inviting customers to sign in, or
 * new visitors to create an account. Both open the store's account page, which
 * signs in with an emailed code and creates the account if the email is new.
 * Hidden once the visitor is signed in (the header shows their name instead).
 */
export function AccountPrompt() {
  if (useStoreCustomer()) return null

  return (
    <p className="mx-auto mt-5 max-w-xl text-base text-slate-600">
      Already a customer?{' '}
      <Link href={ACCOUNT_PATH} className={linkClasses}>
        Sign in
      </Link>{' '}
      to get your account pricing and order history. New to Woody&rsquo;s Paper?{' '}
      <Link href={ACCOUNT_PATH} className={linkClasses}>
        Join today
      </Link>
      . All it takes is your email.
    </p>
  )
}
