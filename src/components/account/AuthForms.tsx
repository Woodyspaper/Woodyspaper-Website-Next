'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ACCOUNT_PAGE, LOGIN_PATH, SIGNUP_PATH, api, refreshAccount } from '@/services/account'
import { AccountCard, ErrorNote, Field, Notice, PrimaryButton, fieldClasses, linkClasses } from './ui'

const PASSWORD_MIN = 10
const RESET_PATH = '/reset-password'

/** Runs a form's request: tracks "busy" and shows the server's message on failure. */
function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/auth/login', { email, password })
      await refreshAccount()
      router.push(ACCOUNT_PAGE)
    })
  }

  return (
    <AccountCard title="Sign in" intro="Sign in to your Woody’s Paper account.">
      <form onSubmit={submit} className="space-y-5">
        <Field label="Email">
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Password">
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <ErrorNote message={error} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href={RESET_PATH} className={linkClasses}>
          Forgot your password?
        </Link>
      </p>
      <p className="mt-3 text-center text-sm text-slate-600">
        New here?{' '}
        <Link href={SIGNUP_PATH} className={linkClasses}>
          Create an account
        </Link>
      </p>
    </AccountCard>
  )
}

export function SignupForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/auth/signup', { name, email, password })
      await refreshAccount()
      // The account page asks for the confirmation code next.
      router.push(ACCOUNT_PAGE)
    })
  }

  return (
    <AccountCard
      title="Create your account"
      intro="One account for Woody’s Paper. If you already order from our store, you can link that account in the next step."
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Name">
          <input
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="Password" hint={`At least ${PASSWORD_MIN} characters.`}>
          <input
            required
            type="password"
            minLength={PASSWORD_MIN}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <ErrorNote message={error} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating account…' : 'Create account'}
        </PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link href={LOGIN_PATH} className={linkClasses}>
          Sign in
        </Link>
      </p>
      <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
        See our{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-brand-blue">
          Privacy Policy
        </Link>{' '}
        for how we handle your details.
      </p>
    </AccountCard>
  )
}

export function ResetPasswordForm() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()

  const requestCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/auth/forgot-password', { email })
      setStep('code')
    })
  }

  const setNewPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      await api('/api/auth/reset-password', { email, code, password })
      await refreshAccount()
      router.push(ACCOUNT_PAGE)
    })
  }

  if (step === 'email') {
    return (
      <AccountCard title="Reset your password" intro="Enter your account’s email and we’ll send you a code.">
        <form onSubmit={requestCode} className="space-y-5">
          <Field label="Email">
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClasses}
            />
          </Field>
          <ErrorNote message={error} />
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Sending…' : 'Email me a code'}
          </PrimaryButton>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href={LOGIN_PATH} className={linkClasses}>
            Back to sign in
          </Link>
        </p>
      </AccountCard>
    )
  }

  return (
    <AccountCard title="Reset your password">
      <form onSubmit={setNewPassword} className="space-y-5">
        <Notice>If {email} has an account, a 6-digit code is on its way. It expires in 15 minutes.</Notice>
        <Field label="Code from the email">
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <Field label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
          <input
            required
            type="password"
            minLength={PASSWORD_MIN}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={fieldClasses}
          />
        </Field>
        <ErrorNote message={error} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Set new password'}
        </PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <button type="button" onClick={() => setStep('email')} className={linkClasses}>
          Use a different email
        </button>
      </p>
    </AccountCard>
  )
}
