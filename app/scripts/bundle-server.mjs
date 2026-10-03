// Packs the server into the app, so "Set up DeviceTally" can create it in the user's Cloudflare account:
// src-tauri/server/worker.js (the bundled Worker) and src-tauri/server/migrations.json (ordered SQL).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'dt-worker-'))
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
// Windows: Node only runs .cmd files through a shell.
execFileSync(npx, ['wrangler', 'deploy', '--dry-run', '--outdir', out], { cwd: '../worker', stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' })
mkdirSync('src-tauri/server', { recursive: true })
copyFileSync(join(out, 'index.js'), 'src-tauri/server/worker.js')
const dir = '../worker/migrations'
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
writeFileSync('src-tauri/server/migrations.json', JSON.stringify(migrations))
// The server's own version (not the app's), so the app asks for a server update only when it changed.
writeFileSync('src-tauri/server/version.txt', readFileSync('../worker/src/version.ts', 'utf8').match(/SERVER_VERSION = '([^']+)'/)[1])
console.log(`server → src-tauri/server (worker.js, ${migrations.length} migrations)`)
