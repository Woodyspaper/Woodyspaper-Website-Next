import Link from 'next/link'
import { listHref } from '@/services/storeRoutes'
import { Reveal } from './Reveal'

/*
 * "About Woody's Paper" on the home page. It says in plain words who we are
 * and what we sell, which is also what search engines read: the product and
 * brand names below are the terms customers search for.
 *
 * Everything here is written into the page's HTML (nothing is loaded from the
 * store), so it must be kept true by hand. If a product line or brand is
 * dropped in Lightspeed, take it out here too; add new ones as they arrive.
 */

/** What we sell, grouped the way a customer would look for it. */
const PRODUCT_LINES = [
  {
    title: 'Printing & copy paper',
    body: 'Copy and printing paper, text and cover stock, paper board, carbonless (NCR) paper, label paper, receipt paper rolls and wide format material.',
  },
  {
    title: 'Envelopes',
    body: '#10 business and window envelopes, catalog, booklet, remittance, coin and invitation envelopes, in white wove, kraft and colors.',
  },
  {
    title: 'Packaging & food service',
    body: 'Packaging supplies, food containers, food handling supplies, wrapping film and tissue paper.',
  },
  {
    title: 'Print shop & office',
    body: 'Finishing and binding supplies, printing supplies, fine art paper and stationery, office supplies and medical-use products.',
  },
]

/**
 * The store's categories, as links into the inventory. The id is what the
 * store goes by; the words before it are only for a readable address.
 * Keep in step with the categories in Lightspeed.
 */
const CATEGORIES: { id: number; name: string }[] = [
  { id: 206814379, name: 'Printing Paper' },
  { id: 206814145, name: 'Envelopes' },
  { id: 206814146, name: 'Carbonless Paper' },
  { id: 206814372, name: 'Fine Art Paper & Stationery' },
  { id: 206814151, name: 'Paper Board' },
  { id: 206814150, name: 'Label Paper' },
  { id: 206814378, name: 'Receipt Paper' },
  { id: 206814160, name: 'Wide Format Material' },
  { id: 206814156, name: 'Tissue Paper' },
  { id: 206814371, name: 'Packaging' },
  { id: 206814157, name: 'Containers' },
  { id: 206814148, name: 'Food Handling' },
  { id: 206817125, name: 'Wrapping Film' },
  { id: 206814144, name: 'Finishing Supplies' },
  { id: 206814377, name: 'Printing Supplies' },
  { id: 206817121, name: 'Office Supplies' },
  { id: 206814376, name: 'Medical Use' },
]

/** Brands named in the text. Keep to brands that are actually in stock. */
const BRANDS = [
  'Hammermill',
  'Astrobrights',
  'NCR Superior',
  'Wausau',
  'Classic Linen',
  'Classic Crest',
  'Springhill',
  'Accent',
  'Endurance',
  'Printmaster',
  'Seville',
]

export function AboutSection() {
  return (
    <Reveal as="section" id="about" className="scroll-mt-chrome px-4 pb-14 pt-4 sm:pb-16 lg:scroll-mt-chrome-lg">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-ultra text-brand-blue">About us</p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              South Florida&rsquo;s wholesale <span className="font-light italic text-brand-blue">paper &amp; packaging</span>{' '}
              supplier
            </h2>
            <div className="mt-5 space-y-4 text-base leading-relaxed text-slate-600">
              <p>
                Woody&rsquo;s Paper is a wholesale paper and packaging supplier serving South Florida. We stock more
                than a thousand products in our warehouse, from copy paper and envelopes to food containers and
                wrapping film, and dispatch orders daily across the region.
              </p>
              <p>
                We sell wholesale and retail. Regular buyers get their own account pricing, and anyone can order
                online, call the warehouse or send us a product list for a quote.
              </p>
              <p>
                We carry brands printers and offices ask for by name, including {BRANDS.slice(0, -1).join(', ')} and{' '}
                {BRANDS[BRANDS.length - 1]}.
              </p>
            </div>
          </div>

          <div>
            <h3 className="font-sans text-sm font-black uppercase tracking-ultra text-slate-500">What we sell</h3>
            <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {PRODUCT_LINES.map((line) => (
                <div key={line.title} className="py-4">
                  <dt className="text-base font-bold text-ink">{line.title}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-slate-600">{line.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <nav aria-label="Product categories we stock" className="mt-10">
          <h3 className="font-sans text-sm font-black uppercase tracking-ultra text-slate-500">Browse by product type</h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((category) => (
              <li key={category.id}>
                <Link
                  href={listHref({ category: category.id })}
                  className="block rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-blue/40 hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Reveal>
  )
}
