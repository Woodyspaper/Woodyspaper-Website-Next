'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { INQUIRY_ADDRESS, buildInquiryMailto, submitInquiry } from '@/services/inquiries'
import { Reveal } from './Reveal'

const fieldClasses =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:ring-2 focus:ring-brand-blue/30'

/**
 * Supply inquiry: a compact card at the foot of the home page for visitors
 * who'd rather send a product list than shop. Deliberately small; the page's
 * main job is getting people into the store.
 */
export function InquirySection() {
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [details, setDetails] = useState('')
  const [honey, setHoney] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [mailtoHref, setMailtoHref] = useState('')
  /** When the form appeared, for the "too fast to be a person" check. */
  const startedAt = useRef(0)

  useEffect(() => {
    startedAt.current = Date.now()
  }, [])

  const reset = () => {
    startedAt.current = Date.now()
    setCompany('')
    setEmail('')
    setDetails('')
    setHoney('')
    setErrorMessage('')
    setMailtoHref('')
    setStatus('idle')
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const inquiry = { company, email, details, honey, startedAt: startedAt.current }
    setMailtoHref(buildInquiryMailto(inquiry))
    setStatus('sending')
    setErrorMessage('')
    try {
      await submitInquiry(inquiry)
      setStatus('sent')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The inquiry could not be emailed.')
      setStatus('error')
    }
  }

  return (
    <Reveal as="section" id="contact" className="scroll-mt-chrome px-4 py-10 sm:py-14 lg:scroll-mt-chrome-lg">
      <div className="mx-auto grid max-w-5xl gap-6 rounded-card border border-slate-100 bg-white p-6 shadow-glass sm:p-8 md:grid-cols-[1fr_1.4fr] md:gap-10">
        <div className="text-center md:text-left">
          <h2 className="text-2xl font-bold tracking-tight">Need a quote?</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Send us your product list and our warehouse team will reply with pricing and availability.
          </p>
          <p className="mt-4 text-sm text-slate-600">
            Prefer to talk?{' '}
            <a href="tel:7547011797" className="font-bold text-brand-blue transition-colors hover:text-brand-blue-dark">
              (754) 701-1797
            </a>
          </p>
        </div>

        {status === 'sent' ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center" aria-live="polite">
            <p className="text-base font-semibold text-ink">
              <span className="mr-2 inline-flex size-7 items-center justify-center rounded-full bg-brand-mist text-sm font-bold text-brand-blue">
                ✓
              </span>
              Inquiry sent.
            </p>
            <p className="text-sm text-slate-600">We&rsquo;ll follow up at {email} with current pricing and availability.</p>
            <button
              type="button"
              onClick={reset}
              className="text-sm font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark"
            >
              Send another inquiry
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="relative space-y-3">
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honey}
              onChange={(event) => setHoney(event.target.value)}
              className="absolute -left-[9999px] h-px w-px opacity-0"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                required
                aria-label="Business name"
                placeholder="Business name"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className={fieldClasses}
              />
              <input
                required
                type="email"
                aria-label="Contact email"
                placeholder="Contact email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={fieldClasses}
              />
            </div>
            <textarea
              required
              rows={3}
              aria-label="Product list"
              placeholder="Type or paste your product list…"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              className={`${fieldClasses} resize-y`}
            />

            {status === 'error' ? (
              <p role="alert" className="text-sm font-semibold text-red-600">
                {errorMessage} You can also{' '}
                <a href={mailtoHref} className="underline">
                  email {INQUIRY_ADDRESS} yourself
                </a>{' '}
                or call (754) 701-1797.
              </p>
            ) : null}

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <p className="text-xs leading-relaxed text-slate-500">
                Emails your inquiry to our warehouse team. See our{' '}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-brand-blue">
                  Privacy Policy
                </Link>
                .
              </p>
              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full shrink-0 rounded-full bg-brand-blue px-7 py-2.5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95 sm:w-auto"
              >
                {status === 'sending' ? 'Sending…' : 'Send inquiry'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Reveal>
  )
}
