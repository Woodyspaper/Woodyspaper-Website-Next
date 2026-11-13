import type { MetadataRoute } from 'next'

// Written out as a plain file when the site is built (see next.config.ts).
export const dynamic = 'force-static'

const SITE_URL = 'https://woodyspaper.com'

/**
 * /robots.txt. Search engines may read the public pages; the account pages,
 * the checkout and the API hold nothing for them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/login', '/signup', '/reset-password', '/checkout'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
