'use client'

import Link from 'next/link'
import { LOGIN_PATH, SIGNUP_PATH, useAccount } from '@/services/account'

const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

/**
 * One line under the Inventory Hub heading inviting customers to sign in to
 * their website account, or new visitors to create one. Hidden once the
 * visitor is signed in (the header shows their name instead).
 */
export function AccountPrompt() {
  // undefined (not known yet) shows the prompt, so the page doesn't jump for signed-out visitors.
  if (useAccount()) return null

  return (
    <p className="mx-auto mt-5 max-w-xl text-base text-slate-600">
      Already a customer?{' '}
      <Link href={LOGIN_PATH} className={linkClasses}>
        Sign in
      </Link>{' '}
      to get your account pricing and order history. New to Woody&rsquo;s Paper?{' '}
      <Link href={SIGNUP_PATH} className={linkClasses}>
        Create an account
      </Link>
      .
    </p>
  )
}
