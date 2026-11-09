'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { InventorySection } from './InventorySection'

/** Reads ?q= (search) and ?account (open account page) from the URL for the hub. */
export function InventoryContent() {
  const params = useSearchParams()
  const query = params.get('q') ?? ''
  const openAccount = params.has('account')

  useEffect(() => {
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query])

  return <InventorySection initialQuery={query} openAccount={openAccount} />
}
