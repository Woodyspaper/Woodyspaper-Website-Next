import { useEffect, useRef, useState } from 'react'

/** Show content immediately where an observer or motion isn't available/wanted. */
const showImmediately = () =>
  typeof IntersectionObserver === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Fades an element in the first time it scrolls into view.
 * Returns a ref to attach and a boolean to drive Tailwind classes.
 *
 * Starts hidden on both the server and the first client render so hydration
 * matches; the browser-only checks run in the effect.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.12) {
  const ref = useRef<T>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || revealed) return

    if (showImmediately()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync with browser capabilities
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true)
            observer.disconnect()
          }
        }
      },
      { threshold, rootMargin: '0px 0px -10% 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, revealed])

  return { ref, revealed }
}
