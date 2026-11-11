import type { ButtonHTMLAttributes, ReactNode } from 'react'

/* Shared pieces of the sign-in, sign-up, reset and account pages. */

export const fieldClasses =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3.5 text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:bg-white focus:ring-2 focus:ring-brand-blue/30'

export const linkClasses =
  'font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark hover:decoration-brand-blue'

/** The white panel every account page sits in. */
export function AccountCard({ title, intro, wide, children }: { title: string; intro?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className="px-4 py-12 sm:py-16">
      <div
        className={`mx-auto rounded-panel border border-slate-100 bg-white p-6 text-ink shadow-glass sm:p-10 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        {intro ? <p className="mt-3 text-base leading-relaxed text-slate-600">{intro}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

export function PrimaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-full bg-brand-blue px-8 py-3.5 text-base font-semibold text-white shadow-cta transition-colors hover:bg-brand-blue-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95 ${className}`}
    />
  )
}

export function SecondaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-full border border-brand-blue/30 bg-white px-6 py-3 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95 ${className}`}
    />
  )
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm font-semibold text-red-600">
      {message}
    </p>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="rounded-2xl bg-brand-mist px-5 py-3.5 text-sm text-ink">
      {children}
    </p>
  )
}
