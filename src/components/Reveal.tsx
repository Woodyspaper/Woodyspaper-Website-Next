'use client'

import type { ElementType, ReactNode } from 'react'
import { useReveal } from '@/hooks/useReveal'

type RevealProps = {
  children: ReactNode
  className?: string
  /** Element to render, e.g. "section". Defaults to a div. */
  as?: ElementType
  id?: string
  delay?: 'none' | 'short' | 'long'
}

const delayClass = {
  none: '',
  short: 'delay-150',
  long: 'delay-300',
} as const

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, className = '', as, id, delay = 'none' }: RevealProps) {
  const Tag = (as ?? 'div') as ElementType
  const { ref, revealed } = useReveal<HTMLDivElement>()

  return (
    <Tag
      ref={ref}
      id={id}
      className={`transition-[opacity,translate] duration-700 ease-brand ${delayClass[delay]} ${
        revealed ? 'translate-none opacity-100' : 'translate-y-4 opacity-0'
      } ${className}`}
    >
      {children}
    </Tag>
  )
}
