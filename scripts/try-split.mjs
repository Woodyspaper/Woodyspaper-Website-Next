// Try the production setup on this computer only: `npm run try:split`.
//
// Builds the site and the API the way they are hosted (two separate parts),
// then runs both here:
//
//   the pages  http://127.0.0.1:5200   (stands in for the web host)
//   the API    http://127.0.0.1:5100   (stands in for api.woodyspaper.com)
//
// Nothing is uploaded or published. It uses the real database and sends real
// emails, exactly as .env.local says. Ctrl+C stops both.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_PORT = 5200
const API_PORT = 5100
const SITE = `http://127.0.0.1:${SITE_PORT}`
const API = `http://127.0.0.1:${API_PORT}`

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env, NEXT_PUBLIC_API_URL: API, SITE_ORIGINS: SITE }

for (const target of ['site', 'api']) {
  const built = spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs'), target], { cwd: root, stdio: 'inherit', env })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

// The API, as `npm start` runs it.
const api = spawn(process.execPath, [join(root, 'scripts', 'start-api.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, PORT: String(API_PORT) },
})
api.on('exit', (code) => process.exit(code ?? 0))

// The pages: out/ served as plain files, as a web host would.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}
const out = join(root, 'out')

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', SITE).pathname)).replace(/^[/\\]+/, '')
  let file = join(out, path)
  try {
    if (!file.startsWith(out)) throw new Error('outside out/')
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    const notFound = await readFile(join(out, '404.html')).catch(() => 'Not found')
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(notFound)
  }
}).listen(SITE_PORT, '127.0.0.1', () => {
  console.log(`\nOpen ${SITE} in a browser on this computer. Ctrl+C stops it.\n`)
})
