'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { api, refreshAccount } from '@/services/account'
import { ErrorNote, Field, Notice, PrimaryButton, SecondaryButton, fieldClasses } from './ui'

const PASSWORD_MIN = 10

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : 'Something went wrong. Please try again.'

/** Change the name on the account. */
export function ChangeName({ name, onChanged }: { name: string; onChanged: () => Promise<void> }) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const unchanged = value.trim() === name

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await api('/api/account/profile', { name: value })
      // The header shows the first name, so it is asked again too.
      await Promise.all([refreshAccount(), onChanged()])
      setSaved(true)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name">
        <input
          required
          maxLength={100}
          autoComplete="name"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setSaved(false)
          }}
          className={fieldClasses}
        />
      </Field>
      <ErrorNote message={error} />
      {saved ? <Notice>Your name is updated.</Notice> : null}
      <SecondaryButton type="submit" disabled={busy || unchanged}>
        {busy ? 'Saving…' : 'Save name'}
      </SecondaryButton>
    </form>
  )
}

/**
 * Change the password while signed in. The current password is asked for
 * again; the server then signs out every other browser and emails a notice.
 */
export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setChanged(false)
    try {
      await api('/api/account/password', { currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setChanged(true)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Current password">
        <input
          required
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          className={fieldClasses}
        />
      </Field>
      <Field label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
        <input
          required
          type="password"
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          className={fieldClasses}
        />
      </Field>
      <ErrorNote message={error} />
      {changed ? (
        <Notice>Your password is changed. Other browsers signed in to your account have been signed out.</Notice>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Changing…' : 'Change password'}
      </PrimaryButton>
    </form>
  )
}
