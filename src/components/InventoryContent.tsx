'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { InventorySection } from './InventorySection'

type InventoryContentProps = {
  /**
   * Home page: the store is a front window for this page (e.g. "/inventory").
   * Clicks, searches and sign-in open there, and the tab keeps the page's title.
   */
  hubPath?: string
}

/** Reads ?q= (search) and ?account (open account page) from the URL for the store. */
export function InventoryContent({ hubPath }: InventoryContentProps) {
  const params = useSearchParams()
  const query = params.get('q') ?? ''
  const openAccount = params.has('account')

  useEffect(() => {
    if (hubPath) return
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query, hubPath])

  return <InventorySection initialQuery={query} openAccount={openAccount} hubPath={hubPath} />
}
