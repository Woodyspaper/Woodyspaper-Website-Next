// Production builds. Usage: node scripts/build.mjs site | api
//
//   site  -> out/    the pages as plain files, to upload to the web host
//   api   -> .next/  the API only, run with `npm start` next to SQL Server
//
// See next.config.ts for how the two differ.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const target = process.argv[2]
if (target !== 'site' && target !== 'api') {
  console.error('Usage: node scripts/build.mjs site | api')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BUILD_TARGET: target },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), ['build'])
if (target === 'site') run(fileURLToPath(new URL('./add-home-meta.mjs', import.meta.url)), [])
