// Runs the API build: `npm start`. Listens on 127.0.0.1:5100 only; the
// Cloudflare Tunnel publishes it as https://api.woodyspaper.com.
//
// BUILD_TARGET=api tells next.config.ts to use the API's own build folder
// (.next-api), the one `npm run build:api` wrote.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url))
const api = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', process.env.PORT || '5100'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
  env: { ...process.env, BUILD_TARGET: 'api' },
})
api.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => api.kill(signal))
