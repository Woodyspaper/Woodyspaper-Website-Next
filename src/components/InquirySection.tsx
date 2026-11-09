'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { INQUIRY_ADDRESS, buildInquiryMailto, submitInquiry } from '@/services/inquiries'
import { Reveal } from './Reveal'

const fieldClasses =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:ring-2 focus:ring-brand-blue/30'

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
      <Reveal as="section" id="contact" className="scroll-mt-chrome px-4 py-12 sm:py-16 lg:scroll-mt-chrome-lg">
      <div className="relative mx-auto grid max-w-6xl gap-10 overflow-hidden rounded-panel bg-brand-blue p-6 text-white shadow-panel sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-14">
        <div className="absolute right-0 top-0 size-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/5 blur-3xl" aria-hidden="true" />

        <div className="z-10 text-center lg:text-left">
          <h2 className="mb-6 text-4xl font-bold italic leading-tight sm:text-5xl">Supply Inquiry.</h2>
          <p className="mx-auto mb-12 max-w-md text-lg leading-relaxed text-white/90 sm:text-xl lg:mx-0">
            Get verified wholesale pricing and local delivery schedules from our team.
          </p>
          <a
            href="tel:7547011797"
            className="mb-4 block text-3xl font-bold tracking-tight transition-colors hover:text-brand-sky focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:text-4xl"
          >
            (754) 701-1797
          </a>
          <p className="text-sm font-black uppercase tracking-ultra text-white/65">
            South Florida Warehouse Hub
          </p>
        </div>

        <div className="z-10 rounded-card bg-white p-5 text-ink shadow-lift sm:p-8">
          {status === 'sent' ? (
            <div className="py-12 text-center" aria-live="polite">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-mist text-xl font-bold text-brand-blue">
                ✓
              </span>
              <h3 className="mt-4 text-2xl font-bold">Inquiry sent.</h3>
              <p className="mt-2 text-base text-slate-600">
                We emailed your request to our warehouse team. They&rsquo;ll follow up at {email}{' '}
                with current pricing and availability.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-8 rounded-full bg-brand-blue px-8 py-3.5 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue active:scale-95"
              >
                Send another inquiry
              </button>
            </div>
          ) : (
            <form onSubmit={send} className="relative space-y-5">
              <input
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={honey}
                onChange={(event) => setHoney(event.target.value)}
                className="absolute -left-[9999px] h-px w-px opacity-0"
              />
              <input
                required
                aria-label="Business name"
                placeholder="Business Name"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className={fieldClasses}
              />
              <input
                required
                type="email"
                aria-label="Contact email"
                placeholder="Contact Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={fieldClasses}
              />
              <div className="relative">
                <textarea
                  required
                  aria-label="Product list"
                  placeholder="Type or paste your product list here..."
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  className={`${fieldClasses} h-40 resize-none pb-16`}
                />
              </div>

              {status === 'error' ? (
                <p role="alert" className="text-sm font-semibold text-red-600">
                  {errorMessage} You can also{' '}
                  <a href={mailtoHref} className="underline">
                    email {INQUIRY_ADDRESS} yourself
                  </a>{' '}
                  or call (754) 701-1797.
                </p>
              ) : null}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full rounded-full bg-brand-blue py-4 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95"
              >
                {status === 'sending' ? 'Sending inquiry…' : 'Send Inquiry'}
              </button>

              <p className="text-center text-xs leading-relaxed text-slate-500">
                This emails your inquiry directly to our warehouse team. Prefer to talk? Call
                (754) 701-1797.
              </p>
            </form>
          )}
        </div>
      </div>
    </Reveal>
  )
}
