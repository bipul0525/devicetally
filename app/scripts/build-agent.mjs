// Builds the Go agent as the app's bundled sidecar: src-tauri/binaries/devicetally-<target triple>[.exe]
// (Tauri's externalBin naming). TARGET overrides the triple for cross builds in CI.
import { execFileSync } from 'node:child_process'

const triple = process.env.TARGET || execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (\S+)/)[1]
const goos = triple.includes('apple') ? 'darwin' : triple.includes('windows') ? 'windows' : 'linux'
const goarch = triple.startsWith('aarch64') ? 'arm64' : 'amd64'
const out = `src-tauri/binaries/devicetally-${triple}${goos === 'windows' ? '.exe' : ''}`
const version = process.env.AGENT_VERSION?.replace(/^v/, "") || "0.0.0-dev"
execFileSync('go', ['build', '-trimpath', '-ldflags', `-s -w -X main.Version=${version}`, '-o', `../app/${out}`, './cmd/devicetally'], {
  cwd: '../agent', stdio: 'inherit', env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
})
console.log(`agent → ${out}`)
