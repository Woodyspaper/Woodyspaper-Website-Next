'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ApiFailure, LOGIN_PATH, api, refreshAccount, signOut } from '@/services/account'
import { ACCOUNT_PATH as STORE_ACCOUNT_PATH } from '@/services/storeCustomer'
import { LoadError, Skeleton } from '../Skeleton'
import { ChangeName, ChangePassword } from './AccountSettings'
import { AccountCard, ErrorNote, Field, Notice, PrimaryButton, SecondaryButton, fieldClasses, linkClasses } from './ui'

/** What GET /api/account returns. */
type AccountData = {
  user: { name: string; email: string; emailVerified: boolean }
  store: {
    method: 'linked' | 'sso'
    email: string
    name: string | null
    pricingGroup: string | null
    found: boolean
  } | null
  /** The customer account (our own customer list) this website account is matched to. */
  customer: { companyName: string | null; name: string | null; pricingGroup: string | null } | null
  canCreateStoreAccount: boolean
}

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : 'Something went wrong. Please try again.'

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-chrome space-y-4 border-t border-slate-100 pt-8 lg:scroll-mt-chrome-lg">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-36 shrink-0 text-sm font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-base text-ink">{children}</dd>
    </div>
  )
}

/** The /account page: profile, email confirmation, customer pricing, and the Lightspeed store account. */
export function AccountPanel() {
  const router = useRouter()
  const [data, setData] = useState<AccountData | null>(null)
  const [loadError, setLoadError] = useState('')

  /** Signed out → the sign-in page; anything else is shown as an error. */
  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiFailure && failure.status === 401) router.replace(LOGIN_PATH)
      else setLoadError(message(failure))
    },
    [router],
  )

  /** Re-reads the account after something on the page changed it. */
  const load = useCallback(
    () =>
      api<AccountData>('/api/account').then((fresh) => {
        setData(fresh)
        setLoadError('')
      }, fail),
    [fail],
  )

  useEffect(() => {
    let cancelled = false
    api<AccountData>('/api/account').then(
      (fresh) => {
        if (!cancelled) setData(fresh)
      },
      (failure) => {
        if (!cancelled) fail(failure)
      },
    )
    return () => {
      cancelled = true
    }
  }, [fail])

  if (loadError) {
    // The request was already retried automatically; this is the visitor's own retry.
    const tryAgain = () => {
      setLoadError('')
      void load()
    }
    return (
      <AccountCard title="Your account" wide>
        <LoadError onRetry={tryAgain}>We couldn&rsquo;t load your account. {loadError}</LoadError>
      </AccountCard>
    )
  }
  if (!data) {
    // Placeholders in the shape of the page: name and email, then the store account section.
    return (
      <AccountCard title="Your account" wide>
        <div role="status" aria-label="Loading your account" className="space-y-8">
          <div className="space-y-4">
            <Skeleton className="h-5 w-64 max-w-full" />
            <Skeleton className="h-5 w-80 max-w-full" />
          </div>
          <div className="space-y-4 border-t border-slate-100 pt-8">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-48" />
          </div>
        </div>
      </AccountCard>
    )
  }

  return (
    <AccountCard title="Your account" wide>
      <div className="space-y-8">
        <dl className="space-y-3">
          <Detail label="Name">{data.user.name}</Detail>
          <Detail label="Email">{data.user.email}</Detail>
        </dl>

        {data.user.emailVerified ? (
          <Section title="Your pricing" id="customer-pricing">
            {data.customer ? (
              <MatchedCustomer customer={data.customer} onChange={load} />
            ) : (
              <ClaimCustomer email={data.user.email} onChange={load} />
            )}
          </Section>
        ) : null}

        {data.user.emailVerified ? (
          <Section title="Store account" id="store-account">
            {data.store ? (
              <LinkedStore store={data.store} onChange={load} />
            ) : (
              <LinkStore email={data.user.email} canCreate={data.canCreateStoreAccount} onChange={load} />
            )}
          </Section>
        ) : (
          <Section title="Confirm your email">
            <ConfirmEmail email={data.user.email} onDone={load} />
          </Section>
        )}

        <Section title="Your details">
          <ChangeName name={data.user.name} onChanged={load} />
        </Section>

        <Section title="Password">
          <ChangePassword />
        </Section>

        <div className="border-t border-slate-100 pt-8">
          <SecondaryButton type="button" onClick={() => void signOut()}>
            Sign out
          </SecondaryButton>
        </div>
      </div>
    </AccountCard>
  )
}

function ConfirmEmail({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/verify-email', { code })
      await refreshAccount()
      await onDone()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError('')
    setResent(false)
    try {
      await api('/api/auth/send-verification', {})
      setResent(true)
    } catch (failure) {
      setError(message(failure))
    }
  }

  return (
    <form onSubmit={confirm} className="space-y-5">
      <p className="text-base text-slate-600">
        We emailed a 6-digit code to <strong className="text-ink">{email}</strong>. Enter it here to finish
        setting up your account. It expires in 15 minutes.
      </p>
      <Field label="Code from the email">
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className={`${fieldClasses} max-w-48`}
        />
      </Field>
      <ErrorNote message={error} />
      {resent ? <Notice>A new code is on its way.</Notice> : null}
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Confirm email'}
        </PrimaryButton>
        <button type="button" onClick={() => void resend()} className={`text-sm ${linkClasses}`}>
          Send a new code
        </button>
      </div>
    </form>
  )
}

/**
 * Matching the website account to the customer account we hold (the one with
 * their agreed prices). They enter the email we know them by; if it is the
 * email they signed up with the match is made at once, otherwise we email
 * that address a code. See src/server/customers.ts.
 */
function ClaimCustomer({ email, onChange }: { email: string; onChange: () => Promise<void> }) {
  const [customerEmail, setCustomerEmail] = useState(email)
  /** The address a code may have been sent to; '' until one has been requested. */
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Their own confirmed email is on no customer account: said plainly, with what to do next. */
  const [noCustomer, setNoCustomer] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  /** The match is made: the header and the product pages learn about it too. */
  const matched = async () => {
    await refreshAccount()
    await onChange()
  }

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      setNoCustomer(false)
      const result = await api<{ linked: boolean; noCustomer?: boolean }>('/api/customer/claim/start', { email: customerEmail })
      if (result.linked) await matched()
      else if (result.noCustomer) setNoCustomer(true)
      else setSentTo(customerEmail.trim())
    })
  }

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/customer/claim/confirm', { code })
      await matched()
    })
  }

  if (sentTo) {
    return (
      <form onSubmit={confirm} className="space-y-5">
        <Notice>
          If <strong>{sentTo}</strong> is the email on a customer account with us, we emailed it a 6-digit code. Enter
          it here to see your pricing. It expires in 15 minutes. Nothing after a few minutes? Call (754) 701-1797 and
          we&rsquo;ll set it up.
        </Notice>
        <Field label="Code from the email">
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${fieldClasses} max-w-48`}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex flex-wrap items-center gap-4">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Show my pricing'}
          </PrimaryButton>
          <button
            type="button"
            onClick={() => {
              setSentTo('')
              setCode('')
              setError('')
            }}
            className={`text-sm ${linkClasses}`}
          >
            Try a different email
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={start} className="space-y-5">
      <p className="text-base text-slate-600">
        Already a Woody&rsquo;s Paper customer with your own pricing? Enter the email we have on file for you and
        we&rsquo;ll show your prices on our product pages whenever you&rsquo;re signed in. If it isn&rsquo;t the email
        you signed up with here, we&rsquo;ll send it a code to confirm it&rsquo;s you.
      </p>
      <Field label="Email on your customer account">
        <input
          required
          type="email"
          autoComplete="email"
          value={customerEmail}
          onChange={(event) => setCustomerEmail(event.target.value)}
          className={fieldClasses}
        />
      </Field>
      <ErrorNote message={error} />
      {noCustomer ? (
        <Notice>
          We don&rsquo;t have a customer account under <strong>{email}</strong>. If we know you by a different email,
          enter that one above. To open an account with us, call (754) 701-1797.
        </Notice>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Find my pricing'}
      </PrimaryButton>
    </form>
  )
}

function MatchedCustomer({ customer, onChange }: { customer: NonNullable<AccountData['customer']>; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const unclaim = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/api/customer/unclaim', {})
      await refreshAccount()
      await onChange()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <dl className="space-y-3">
        {customer.companyName || customer.name ? <Detail label="Customer account">{customer.companyName || customer.name}</Detail> : null}
        <Detail label="Pricing group">{customer.pricingGroup ?? 'Standard pricing'}</Detail>
      </dl>
      <p className="text-base text-slate-600">
        While you&rsquo;re signed in, our{' '}
        <Link href="/inventory" className={linkClasses}>
          product pages
        </Link>{' '}
        show your own prices. Something not right? Call (754) 701-1797.
      </p>
      <ErrorNote message={error} />
      <button type="button" disabled={busy} onClick={() => void unclaim()} className={`text-sm disabled:opacity-50 ${linkClasses}`}>
        This isn&rsquo;t my customer account
      </button>
    </div>
  )
}

function LinkStore({ email, canCreate, onChange }: { email: string; canCreate: boolean; onChange: () => Promise<void> }) {
  const [storeEmail, setStoreEmail] = useState(email)
  /** The address a code was sent to; '' until one has been requested. */
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Their own confirmed email has no store account: said plainly, with what to do next. */
  const [noStoreAccount, setNoStoreAccount] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      setNoStoreAccount(false)
      const result = await api<{ linked: boolean; noStoreAccount?: boolean }>('/api/lightspeed/link/start', {
        email: storeEmail,
      })
      if (result.linked) await onChange()
      else if (result.noStoreAccount) setNoStoreAccount(true)
      else setSentTo(storeEmail.trim())
    })
  }

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/lightspeed/link/confirm', { code })
      await onChange()
    })
  }

  const create = () =>
    void run(async () => {
      const result = await api<{ method: 'linked' | 'sso' }>('/api/lightspeed/store-account', {})
      await refreshAccount()
      if (result.method === 'sso') {
        // A full page load on purpose (not router.push): the store script must
        // start fresh to pick up automatic sign-in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/inventory')
        return
      }
      await onChange()
    })

  if (sentTo) {
    return (
      <form onSubmit={confirm} className="space-y-5">
        <Notice>
          If <strong>{sentTo}</strong> has an account in our store, we emailed it a 6-digit code. Enter it here
          to link the account. It expires in 15 minutes.
        </Notice>
        <Field label="Code from the email">
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${fieldClasses} max-w-48`}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex flex-wrap items-center gap-4">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Linking…' : 'Link store account'}
          </PrimaryButton>
          <button
            type="button"
            onClick={() => {
              setSentTo('')
              setCode('')
              setError('')
            }}
            className={`text-sm ${linkClasses}`}
          >
            Try a different email
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-6">
      <form onSubmit={start} className="space-y-5">
        <p className="text-base text-slate-600">
          Already order from our online store? Link that account to see your details and pricing here. Enter the
          email you use in the store and we&rsquo;ll send it a code.
        </p>
        <Field label="Email on your store account">
          <input
            required
            type="email"
            autoComplete="email"
            value={storeEmail}
            onChange={(event) => setStoreEmail(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <ErrorNote message={error} />
        {noStoreAccount ? (
          <Notice>
            We couldn&rsquo;t find a store account under <strong>{email}</strong>. If you order with a different
            email, enter that one above. If you&rsquo;ve never ordered from us, there&rsquo;s nothing to link
            {canCreate ? ': create your store account below, or just shop.' : ': the store sets one up when you check out.'}
          </Notice>
        ) : null}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Link my store account'}
        </PrimaryButton>
      </form>
      {canCreate ? (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-5">
          <p className="text-sm text-slate-600">
            Never ordered from our store? We&rsquo;ll set up a store account under {email}, and you&rsquo;ll be
            signed in to the store automatically whenever you&rsquo;re signed in here.
          </p>
          <SecondaryButton type="button" disabled={busy} onClick={create}>
            Create my store account
          </SecondaryButton>
        </div>
      ) : null}
    </div>
  )
}

function LinkedStore({ store, onChange }: { store: NonNullable<AccountData['store']>; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const unlink = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/api/lightspeed/unlink', {})
      await refreshAccount()
      await onChange()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <dl className="space-y-3">
        <Detail label="Store email">{store.email}</Detail>
        {store.name ? <Detail label="Name on account">{store.name}</Detail> : null}
        {store.found ? <Detail label="Pricing">{store.pricingGroup ?? 'Standard pricing'}</Detail> : null}
      </dl>
      {store.found ? null : (
        <Notice>
          {store.method === 'sso'
            ? 'Your store account is created the first time you open the store while signed in.'
            : 'We couldn’t reach the store for your account details just now. Try again in a moment.'}
        </Notice>
      )}
      <p className="text-base text-slate-600">
        {store.method === 'sso' ? (
          <>
            You&rsquo;re signed in to the store automatically while you&rsquo;re signed in here.{' '}
            <Link href="/inventory" className={linkClasses}>
              Go to the store
            </Link>
            .
          </>
        ) : (
          <>
            To order with your account pricing,{' '}
            <Link href={STORE_ACCOUNT_PATH} className={linkClasses}>
              sign in to the store
            </Link>{' '}
            with the code it emails to {store.email}.
          </>
        )}
      </p>
      <ErrorNote message={error} />
      <button type="button" disabled={busy} onClick={() => void unlink()} className={`text-sm disabled:opacity-50 ${linkClasses}`}>
        Unlink this store account
      </button>
    </div>
  )
}
