'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { MAX_QUERY_LENGTH } from '@/services/productSearch'
import { InventorySection } from './InventorySection'

/** Reads ?q= (search) and ?account (open account page) from the URL for the store. */
export function InventoryContent() {
  const params = useSearchParams()
  // Capped: a crafted link shouldn't put a wall of text in the tab title or the page.
  const query = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  const openAccount = params.has('account')

  useEffect(() => {
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query])

  return <InventorySection initialQuery={query} openAccount={openAccount} />
}
