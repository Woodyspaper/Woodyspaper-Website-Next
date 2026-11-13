import type { MetadataRoute } from 'next'

// Written out as a plain file when the site is built (see next.config.ts).
export const dynamic = 'force-static'

const SITE_URL = 'https://woodyspaper.com'

/**
 * /sitemap.xml: the pages worth finding in a search. Add a line when a new
 * public page is added. (Every product shares one page, /product?id=…, read
 * in the browser, so products have no separate files for a sitemap to list.)
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/inventory/`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/privacy/`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
