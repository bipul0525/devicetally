// First-time deploy to your Cloudflare account: npm run setup
// Deploys the Worker (creating its D1 database), applies migrations,
// sets a random SETUP_TOKEN and prints the address and token. Safe to run again.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
// Windows: Node only runs .cmd files (npx.cmd) through a shell.
const shell = process.platform === 'win32'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell, ...opts })
const step = (msg) => process.stdout.write(`${msg}...`)
const ok = () => process.stdout.write(' done\n')
const fail = (msg, err) => {
  process.stdout.write('\n')
  console.error(`✗ ${msg}`)
  if (err?.stdout || err?.stderr) console.error(String(err.stdout ?? '') + String(err.stderr ?? ''))
  process.exit(1)
}

// 1. Signed in to Cloudflare?
try {
  const who = run(npx, ['wrangler', 'whoami'])
  if (/not authenticated/i.test(who)) throw new Error()
} catch {
  fail('Not signed in to Cloudflare. Run: npx wrangler login')
}

// 2. Deploy (creates the D1 database on first run)
step('Deploying the Worker')
let url
try {
  const out = run(npx, ['wrangler', 'deploy'])
  url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0]
} catch (e) {
  fail('Deploy failed.', e)
}
ok()

// 3. Database tables
step('Creating database tables')
try {
  run(npx, ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote'])
} catch (e) {
  fail('Applying migrations failed.', e)
}
ok()

// 4. Setup token, only while nobody has claimed this instance yet
let token = null
if (url) {
  const state = await fetch(`${url}/api/auth/state`).then((r) => r.json()).catch(() => null)
  if (state?.setup_needed !== false) {
    step('Setting the setup token')
    token = randomBytes(24).toString('hex')
    const put = spawnSync(npx, ['wrangler', 'secret', 'put', 'SETUP_TOKEN'], { input: token, encoding: 'utf8', shell })
    if (put.status !== 0) fail('Setting SETUP_TOKEN failed.', put)
    ok()
  }
}

console.log('')
console.log(`✓ Your DeviceTally server: ${url ?? '(see the deploy output above)'}`)
if (token) console.log(`✓ Setup token: ${token}\n  In the DeviceTally app: Sign in as admin, tick "First time on this server", and enter this address and token.`)
else console.log('✓ Already set up. Sign in with your email and password.')
