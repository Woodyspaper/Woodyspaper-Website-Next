'use client'

import Link from 'next/link'
import { ACCOUNT_PAGE, LOGIN_PATH, SIGNUP_PATH, useAccount } from '@/services/account'
import { Reveal } from './Reveal'

const STEPS = [
  {
    title: 'Find what you need',
    body: 'Browse by category or search the catalog by product name, size or SKU.',
  },
  {
    title: 'Sign in for your pricing',
    body: 'Create an account and link your Woody’s store account. Regular buyers see their own pricing group.',
  },
  {
    title: 'Order online',
    body: 'Check out in the store. Orders are dispatched daily across South Florida.',
  },
]

const primaryButton =
  'rounded-full bg-brand-blue px-8 py-3.5 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95'

const secondaryButton =
  'rounded-full border border-brand-blue/30 bg-white px-8 py-3.5 text-base font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95'

/**
 * How ordering works, in three steps, with the account buttons underneath.
 * Signed-in customers get a "keep shopping" button in their place. No panel
 * or background: blue numerals and thin rules carry it.
 */
export function HomeSteps() {
  const account = useAccount()
  const firstName = account?.name.trim().split(/\s+/)[0]

  return (
    <Reveal as="section" className="px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Ordering is <span className="font-light italic text-brand-blue">simple</span>
        </h2>

        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-slate-200">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-5 md:flex-col md:gap-3 md:px-10 md:first:pl-0 md:last:pr-0">
              <span className="font-display text-5xl font-bold leading-none text-brand-blue md:text-6xl" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                <span className="block text-lg font-bold text-ink">{step.title}</span>
                <span className="mt-1.5 block text-base leading-relaxed text-slate-600">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          {account ? (
            <>
              <p className="text-base font-semibold text-slate-600 sm:mr-2">Welcome back{firstName ? `, ${firstName}` : ''}.</p>
              <Link href="/inventory" className={primaryButton}>
                Continue shopping
              </Link>
              <Link href={ACCOUNT_PAGE} className={secondaryButton}>
                Your account
              </Link>
            </>
          ) : (
            <>
              <Link href={SIGNUP_PATH} className={primaryButton}>
                Create an account
              </Link>
              <Link href={LOGIN_PATH} className={secondaryButton}>
                Sign in
              </Link>
            </>
          )}
        </div> */}
      </div>
    </Reveal>
  )
}
