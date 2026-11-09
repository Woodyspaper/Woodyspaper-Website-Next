// Runs after `next build`. Adds the home page's description and social-sharing
// tags straight into out/index.html.
//
// Why not Next's `metadata`: the Lightspeed store on the home page rewrites and
// then deletes these tags. If React rendered them, it would crash on the next
// page change trying to remove tags that are gone. Written here, React never
// owns them, while search engines and link previews still read them from the HTML.
import { readFileSync, writeFileSync } from 'node:fs'

const SITE_URL = 'https://woodyspaper.com'
const TITLE = "Woody's Paper | Wholesale Packaging & Tissue Paper South Florida"
const DESCRIPTION =
  "Meet Woody, South Florida's premier professional wholesale advisor for tissue paper and packaging. Serving South Florida."
const SHARE_DESCRIPTION = 'Wholesale packaging and paper solutions dispatched daily across South Florida.'

const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const tags = [
  ['name', 'description', DESCRIPTION],
  ['property', 'og:type', 'website'],
  ['property', 'og:title', TITLE],
  ['property', 'og:description', SHARE_DESCRIPTION],
  ['property', 'og:url', SITE_URL],
  ['name', 'twitter:card', 'summary'],
  ['name', 'twitter:title', TITLE],
  ['name', 'twitter:description', SHARE_DESCRIPTION],
]
  .map(([attr, key, content]) => `<meta ${attr}="${key}" content="${escape(content)}"/>`)
  .join('')

const file = new URL('../out/index.html', import.meta.url)
const html = readFileSync(file, 'utf8')

if (html.includes('name="description"')) {
  console.log('add-home-meta: index.html already has a description; left unchanged.')
} else if (!html.includes('</head>')) {
  throw new Error('add-home-meta: no </head> in out/index.html')
} else {
  // A function replacement, so wording containing "$&" or "$'" is inserted literally.
  writeFileSync(file, html.replace('</head>', () => `${tags}</head>`))
  console.log('add-home-meta: added description and sharing tags to out/index.html')
}
