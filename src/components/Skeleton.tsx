import type { ReactNode } from 'react'

/**
 * A grey, softly pulsing block that stands in for something still loading.
 * Size and shape come from `className` (h-4 w-32, aspect-square rounded-card…).
 * It is pill-shaped unless `className` sets a corner radius of its own. Make
 * it the size of what will replace it, so the page doesn't jump.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  // Two radius classes would fight over which wins, so the default only applies when none is given.
  const radius = /(^|\s)rounded(-|\s|$)/.test(className) ? '' : 'rounded-full'
  return <span aria-hidden="true" className={`block animate-pulse bg-slate-200/70 ${radius} ${className}`} />
}

/**
 * Shown when something couldn't be loaded even after retrying: says so in
 * plain words and offers a button to try again. `onRetry` is left out where
 * trying again isn't possible.
 */
export function LoadError({
  children,
  onRetry,
  retrying = false,
  className = '',
}: {
  children: ReactNode
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={`rounded-card border border-brand-blue/20 bg-brand-mist p-6 text-center text-ink ${className}`}>
      <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-700">{children}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 rounded-full border border-brand-blue/30 bg-white px-6 py-2.5 text-sm font-semibold text-brand-blue transition-colors hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50 active:scale-95"
        >
          {retrying ? 'Trying again…' : 'Try again'}
        </button>
      ) : null}
    </div>
  )
}
