// Finishes a release after all app builds have uploaded: gives the installers clear names, writes
// the in-app updater's latest.json, then removes the .sig files (latest.json carries their contents).
// One writer, so parallel builds can't overwrite each other's entries (seen in v0.8.2).
// Usage (CI): node scripts/updater-json.mjs <tag>   (needs GH_TOKEN; uses the gh CLI)
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const tag = process.argv[2]
const repo = process.env.GITHUB_REPOSITORY || 'bipul0525/devicetally'
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' })
const version = tag.replace(/^v/, '')
const list = () => JSON.parse(gh('api', `repos/${repo}/releases/tags/${tag}`)).assets
// Names people can pick from without knowing CPU codenames. The Linux files and the Mac
// .app.tar.gz keep their names: installers and servers already deployed download them by name.
const clear = {
  [`DeviceTally_${version}_aarch64.dmg`]: `DeviceTally_${version}_mac-apple-silicon.dmg`,
  [`DeviceTally_${version}_x64.dmg`]: `DeviceTally_${version}_mac-intel.dmg`,
  [`DeviceTally_${version}_x64-setup.exe`]: `DeviceTally_${version}_windows-setup.exe`,
  [`DeviceTally_${version}_x64-setup.exe.sig`]: `DeviceTally_${version}_windows-setup.exe.sig`,
}
for (const a of list()) if (clear[a.name]) gh('api', '-X', 'PATCH', `repos/${repo}/releases/assets/${a.id}`, '-f', `name=${clear[a.name]}`)
const assets = list().map((a) => a.name)
const want = {
  'darwin-aarch64': (n) => n === 'DeviceTally_aarch64.app.tar.gz',
  'darwin-x86_64': (n) => n === 'DeviceTally_x64.app.tar.gz',
  'windows-x86_64': (n) => n.endsWith('_windows-setup.exe'),
  'linux-x86_64': (n) => n.endsWith('_amd64.AppImage'),
}
const platforms = {}
for (const [platform, match] of Object.entries(want)) {
  const file = assets.find(match)
  if (!file || !assets.includes(`${file}.sig`)) throw new Error(`${tag}: missing ${platform} package or signature`)
  const signature = execFileSync('curl', ['-fsSL', `https://github.com/${repo}/releases/download/${tag}/${file}.sig`], { encoding: 'utf8' }).trim()
  platforms[platform] = { signature, url: `https://github.com/${repo}/releases/download/${tag}/${file}` }
}
writeFileSync('latest.json', JSON.stringify({ version, notes: `DeviceTally ${version}`, pub_date: new Date().toISOString(), platforms }, null, 2))
gh('release', 'upload', tag, 'latest.json', '--clobber', '--repo', repo)
console.log(`latest.json for ${tag}: ${Object.keys(platforms).join(', ')}`)
// The app's .sig files were only needed for latest.json (the agent's checksums.txt.sig stays).
for (const a of list()) if (a.name.startsWith('DeviceTally') && a.name.endsWith('.sig')) gh('api', '-X', 'DELETE', `repos/${repo}/releases/assets/${a.id}`)
