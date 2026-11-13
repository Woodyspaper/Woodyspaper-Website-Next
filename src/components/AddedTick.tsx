'use client'

import { useEffect, useRef, useState } from 'react'

/** How long an "Add to cart" button says "Added" before it goes back. */
const ADDED_MS = 1800

/**
 * For "Add to cart" buttons: `added` is true for a moment after `flash()` is
 * called, so the button can confirm the product went in. The cart itself
 * stays closed; the header badge pops at the same time (Cart.tsx).
 */
export function useAddedFlash(): [added: boolean, flash: () => void] {
  const [added, setAdded] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flash = () => {
    window.clearTimeout(timer.current)
    setAdded(true)
    timer.current = window.setTimeout(() => setAdded(false), ADDED_MS)
  }
  return [added, flash]
}

/** "✓ Added", with the tick popping in. Announced to screen readers when it appears. */
export function AddedTick() {
  return (
    <span role="status" className="inline-flex items-center justify-center gap-2">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 motion-safe:animate-tick"
        aria-hidden="true"
      >
        <path d="M4 10.5l4 4 8-9" />
      </svg>
      Added
    </span>
  )
}
