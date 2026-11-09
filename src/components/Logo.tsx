'use client'

import Image from 'next/image'
import Link from 'next/link'
import logo from '@/assets/logo.png'

type LogoProps = {
  className?: string
}

export function Logo({ className = '' }: LogoProps) {
  return (
    <Link
      href="/"
      onClick={() => {
        if (window.location.pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className={`group inline-flex shrink-0 items-center ${className}`}
    >
      <Image
        src={logo}
        alt="Woody's Paper — home"
        loading="eager"
        className="h-full w-auto drop-shadow-sm transition-transform duration-200 group-active:scale-95"
      />
    </Link>
  )
}
