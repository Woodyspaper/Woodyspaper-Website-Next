/** Featured wholesale lines shown on the home page preview. */
export type CatalogItem = {
  /** Internal SKU. */
  id: string
  /** Description shown to the customer. */
  description: string
  /** Category label; matches an inventory category title. */
  category: string
  /** Indicative wholesale price, in USD. */
  price: number
  /** Sell unit, e.g. "CASE/1000". */
  unit: string
}

export const catalog: CatalogItem[] = [
  { id: 'TP-2400', description: '2-Ply Jumbo Bath Tissue Roll, 1000ft', category: 'Tissue Paper', price: 48.75, unit: 'CASE/12' },
  { id: 'TP-1150', description: 'White Multifold Hand Towel, 9.25 x 9.4in', category: 'Tissue Paper', price: 32.4, unit: 'CASE/4000' },
  { id: 'TP-0880', description: 'Kraft Hardwound Roll Towel, 800ft', category: 'Tissue Paper', price: 41.2, unit: 'CASE/6' },
  { id: 'FS-3310', description: 'Kraft Fiber Clamshell Container, 9 x 6in', category: 'Food Services', price: 56.9, unit: 'CASE/200' },
  { id: 'FS-2205', description: 'Double Poly Paper Food Tray, 3lb', category: 'Food Services', price: 29.15, unit: 'CASE/500' },
  { id: 'FS-4102', description: 'White Dinner Napkin, 2-Ply 15 x 17in', category: 'Food Services', price: 38.6, unit: 'CASE/3000' },
  { id: 'FS-5090', description: 'Insulated Hot Cup, 12oz with Lid', category: 'Food Services', price: 62.3, unit: 'CASE/1000' },
  { id: 'PK-7720', description: 'Single Wall Corrugated Carton, 12 x 12 x 12in', category: 'Packaging', price: 44.5, unit: 'BUNDLE/25' },
  { id: 'PK-6610', description: 'Machine Grade Stretch Wrap, 80ga x 5000ft', category: 'Packaging', price: 71.0, unit: 'CASE/4' },
  { id: 'PK-3300', description: 'White Butcher Paper Roll, 40lb x 36in', category: 'Packaging', price: 88.25, unit: 'ROLL' },
  { id: 'PK-1180', description: 'Kraft Shopping Bag with Handles, 13 x 7 x 17in', category: 'Packaging', price: 52.4, unit: 'CASE/250' },
  { id: 'FC-9040', description: 'High Density Can Liner, 40 x 48in 16mic', category: 'Facility Care', price: 36.8, unit: 'CASE/250' },
  { id: 'FC-2210', description: 'Foam Hand Soap Refill, 1200mL', category: 'Facility Care', price: 45.9, unit: 'CASE/3' },
  { id: 'FC-5501', description: 'Center Pull Wiper Roll, 600 sheets', category: 'Facility Care', price: 39.75, unit: 'CASE/6' },
]
