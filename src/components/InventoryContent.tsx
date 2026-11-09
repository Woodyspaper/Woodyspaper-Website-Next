'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { InventorySection } from './InventorySection'

type InventoryContentProps = {
  /** Retitle the tab for searches. Off on the home page, which keeps its own title. */
  setPageTitle?: boolean
}

/** Reads ?q= (search) and ?account (open account page) from the URL for the store. */
export function InventoryContent({ setPageTitle = true }: InventoryContentProps) {
  const params = useSearchParams()
  const query = params.get('q') ?? ''
  const openAccount = params.has('account')

  useEffect(() => {
    if (!setPageTitle) return
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query, setPageTitle])

  return <InventorySection initialQuery={query} openAccount={openAccount} />
}
