'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Unknown URLs send visitors back to the home page. */
export default function NotFound() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/')
  }, [router])

  return <div className="min-h-screen" />
}
