import type { MetadataRoute } from 'next'

const SITE_URL = 'https://woodyspaper.com'

/**
 * /robots.txt. Search engines may read the public pages; the account pages
 * and the API hold nothing for them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/login', '/signup', '/reset-password'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
