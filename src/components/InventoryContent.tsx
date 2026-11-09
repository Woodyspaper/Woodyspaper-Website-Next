'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { InventorySection } from './InventorySection'
import { MAX_QUERY_LENGTH } from './StoreSearch'

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
  // Capped: a crafted link shouldn't put a wall of text in the tab title or the page.
  const query = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  const openAccount = params.has('account')

  useEffect(() => {
    if (hubPath) return
    document.title = query
      ? `Search: ${query} | Woody's Paper`
      : "Inventory Hub | Woody's Paper"
  }, [query, hubPath])

  return <InventorySection initialQuery={query} openAccount={openAccount} hubPath={hubPath} />
}
