import { useEffect, useRef } from 'react'

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

/**
 * Subtle pointer-driven 3D tilt. Disabled on touch devices and when the
 * visitor has asked for reduced motion.
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(intensity = 140) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || isCoarsePointer()) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0

    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const x = (window.innerWidth / 2 - event.clientX) / intensity
        const y = (window.innerHeight / 2 - event.clientY) / intensity
        node.style.transform = `rotateY(${x}deg) rotateX(${-y}deg)`
      })
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousemove', onMove)
    }
  }, [intensity])

  return ref
}
