'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { InventorySection } from './InventorySection'

/** Reads ?q= from the URL and hands it to the hub, which opens that search. */
export function InventoryContent() {
  const query = useSearchParams().get('q') ?? ''

  useEffect(() => {
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query])

  return <InventorySection initialQuery={query} />
}
