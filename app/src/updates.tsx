import { invoke } from '@tauri-apps/api/core'
// In-app updates: the app checks the latest release's latest.json, downloads the update for this
// platform, verifies its signature (key in tauri.conf.json) and restarts. No browser download, so
// macOS never shows "damaged".
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useEffect, useState } from 'preact/hooks'
import { listen } from '@tauri-apps/api/event'

const DAY = 24 * 3600_000

/** Checks at most once a day (for the popover note); `force` always checks. */
export async function findUpdate(force = false): Promise<Update | null> {
  let last = 0
  try { last = Number(localStorage.getItem('dt-update-check') ?? 0) } catch {}
  if (!force && Date.now() - last < DAY) {
    try { return localStorage.getItem('dt-update-available') ? await check({ timeout: 30_000 }) : null } catch { return null }
  }
  // A forced check keeps a short log (Settings → Copy details), like an update does.
  const started = Date.now()
  const lines = [`${new Date().toISOString()}  Checking for updates (DeviceTally ${await getVersion().catch(() => '?')})`, `${new Date().toISOString()}  Source: github.com/bipul0525/devicetally/releases/latest/download/latest.json`, `${new Date().toISOString()}  System: ${navigator.userAgent}`]
  let u: Update | null
  try {
    u = await check({ timeout: 30_000 })
  } catch (x) {
    lines.push(`${new Date().toISOString()}  FAILED after ${((Date.now() - started) / 1000).toFixed(1)} s: ${String(x)}`)
    try { localStorage.setItem('dt-update-log', lines.join('\n')) } catch {}
    throw x
  }
  lines.push(`${new Date().toISOString()}  Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${u ? `version ${u.version} available` : 'up to date'}`)
  try {
    localStorage.setItem('dt-update-log', lines.join('\n'))
    localStorage.setItem('dt-update-check', String(Date.now()))
    u ? localStorage.setItem('dt-update-available', u.version) : localStorage.removeItem('dt-update-available')
  } catch {}
  return u
}

export function AppGroup() {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'none' | 'available' | 'updating' | 'error'>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [step, setStep] = useState<UpdateStep | null>(null)
  const [err, setErr] = useState('')
  const [lastFailed] = useState(() => ls.get('dt-update-failed'))
  useEffect(() => { getVersion().then(setVersion) }, [])

  const [secs, setSecs] = useState(0)
  const doCheck = async () => {
    setState('checking'); setErr(''); setSecs(0)
    const t = setInterval(() => setSecs((n) => n + 1), 1000)
    try {
      const u = await findUpdate(true)
      setUpdate(u); setState(u ? 'available' : 'none')
    } catch (x) { setErr(String(x)); setState('error') } finally { clearInterval(t) }
  }
  const install = async () => {
    if (!update) return
    setState('updating'); setErr('')
    try { await runUpdate(update, setStep) } catch (x) { setErr(String(x)); setState('error') }
  }
  const mb = (b: number) => (b / 1e6).toFixed(1)
  const stepText = !step ? 'Starting…'
    : step.phase === 'installing' ? 'Installing…'
    : step.phase === 'restarting' ? 'Restarting…'
    : step.total ? `Downloading… ${mb(step.got)} of ${mb(step.total)} MB (${Math.round((step.got / step.total) * 100)}%)`
    : step.got ? `Downloading… ${mb(step.got)} MB` : 'Downloading…'

  return (
    <section class="section"><h2>App</h2>
      <div class="group">
        <div class="field"><span>DeviceTally {version}</span>
          {state === 'available' || state === 'updating' ? null
            : <button class="btn" disabled={state === 'checking'} onClick={doCheck}>{state === 'checking' ? 'Checking…' : 'Check for updates'}</button>}
        </div>
        {state === 'checking' && (
          <div class="field" role="status" aria-live="polite"><span class="checking"><span class="spinner" aria-hidden="true" />
            {secs < 8 ? `Checking GitHub for a new version… ${secs} s` : `Still checking (${secs} s): the connection may be slow. It gives up after 30 s.`}</span></div>
        )}
        {state === 'none' && <div class="field"><span class="val">✓ You have the latest version.</span></div>}
        {(state === 'available' || state === 'updating') && update && (
          <>
            <div class="field"><span><b>Version {update.version} is available</b></span>
              {state === 'available' && <button class="btn primary" onClick={install}>Update and restart</button>}
            </div>
            {state === 'updating' && (
              <div class="field col" role="status" aria-live="polite">
                <span>{stepText}</span>
                <div class="track update-track"><div class={!step?.total && step?.phase === 'downloading' ? 'indeterminate' : ''} style={{ width: step?.phase === 'downloading' ? (step.total ? `${(step.got / step.total) * 100}%` : '35%') : '100%' }} /></div>
                <span class="hint" style={{ margin: 0 }}>Keep DeviceTally open; it restarts by itself when the update is installed.</span>
              </div>
            )}
            {update.body && state !== 'updating' && <p class="hint" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', margin: '0 0 8px' }} tabIndex={0}>{update.body.replace(/```[\s\S]*?```/g, '').slice(0, 600)}</p>}
          </>
        )}
        <AutoUpdateToggle />
        <DockToggle />
      </div>
      {err && <p class="err" role="alert">{update ? "The update didn't work" : "Couldn't check for updates"}: {/timed out|timeout/i.test(err) ? 'GitHub didn\'t answer within 30 seconds. Check the internet connection and try again.' : updateErrorText(err)} <CopyLog /> <span class="hint">and send it to your DeviceTally admin.</span></p>}
      {!err && lastFailed && lastFailed !== version && state !== 'updating' && <p class="hint">The last update (to {lastFailed}) didn't work. <CopyLog /></p>}
    </section>
  )
}

function AutoUpdateToggle() {
  const [on, setOn] = useState(autoUpdateOn())
  return (
    <div class="field"><label for="dt-auto">Update automatically<div class="hint" style={{ margin: 0 }}>Installs new versions when DeviceTally isn't in use, then tells you. Off: it asks first.</div></label>
      <input id="dt-auto" type="checkbox" checked={on} onChange={(e) => { const v = e.currentTarget.checked; setOn(v); ls.set('dt-auto-update', v ? '1' : '0') }} /></div>
  )
}

/** "Hide from the Dock" (macOS): on by default; DeviceTally then opens from the menu bar. */
export function DockToggle() {
  const [show, setShow] = useState<boolean | null>(null)
  useEffect(() => { invoke<boolean>('get_dock').then(setShow, () => {}) }, [])
  if (show === null || !navigator.userAgent.includes('Mac')) return null
  return (
    <div class="field"><label for="dt-dock">Hide from the Dock<div class="hint" style={{ margin: 0 }}>Open DeviceTally from its menu-bar item.</div></label>
      <input id="dt-dock" type="checkbox" checked={!show} onChange={(e) => { const s = !e.currentTarget.checked; setShow(s); invoke('set_dock', { show: s }) }} /></div>
  )
}

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* fine */ } },
  del: (k: string) => { try { localStorage.removeItem(k) } catch { /* fine */ } },
}

export type UpdateStep = { phase: 'downloading' | 'installing' | 'restarting'; got: number; total: number }

/**
 * Downloads, installs and restarts, reporting each step and keeping a log of this attempt (saved
 * in 'dt-update-log', so a failure can be copied from Settings and sent to the admin).
 */
export async function runUpdate(u: Update, onStep: (s: UpdateStep) => void = () => {}): Promise<void> {
  const lines: string[] = []
  const log = (m: string) => { lines.push(`${new Date().toISOString()}  ${m}`); ls.set('dt-update-log', lines.join('\n')) }
  log(`DeviceTally ${u.currentVersion} → ${u.version}`)
  log(`System: ${navigator.userAgent}`)
  let total = 0, got = 0, lastLogged = 0
  try {
    log('Downloading')
    onStep({ phase: 'downloading', got: 0, total: 0 })
    await u.download((e) => {
      if (e.event === 'Started') { total = e.data.contentLength ?? 0; log(`Download size: ${total ? (total / 1e6).toFixed(1) + ' MB' : 'unknown'}`) }
      if (e.event === 'Progress') {
        got += e.data.chunkLength
        onStep({ phase: 'downloading', got, total })
        if (got - lastLogged > 5e6) { lastLogged = got; log(`Downloaded ${(got / 1e6).toFixed(1)} MB`) }
      }
      if (e.event === 'Finished') log(`Downloaded ${(got / 1e6).toFixed(1)} MB; signature checked`)
    })
    log('Installing')
    onStep({ phase: 'installing', got, total })
    await u.install()
    log('Installed; restarting')
    onStep({ phase: 'restarting', got, total })
    ls.del('dt-update-available'); ls.del('dt-update-failed')
    ls.set('dt-updated-to', u.version)
    await relaunch()
  } catch (x) {
    log(`FAILED: ${String(x)}`)
    ls.set('dt-update-failed', u.version)
    throw x
  }
}

/** A plain reason for an update error. */
export const updateErrorText = (msg: string) =>
  /permission|denied|not permitted|read-only|authoriz/i.test(msg) ? 'This account can\'t install apps here. Ask an admin of this computer.'
  : /network|timed out|timeout|connect|dns|offline|sending request/i.test(msg) ? 'The download didn\'t get through. Check the internet connection and try again.'
  : /signature/i.test(msg) ? 'The download didn\'t pass its signature check, so it wasn\'t installed.'
  : msg.slice(0, 160)

/** Copies the last update attempt's log, to send to the admin. */
export function CopyLog() {
  const [done, setDone] = useState(false)
  return <button class="link-btn" onClick={() => navigator.clipboard.writeText(ls.get('dt-update-log') ?? 'No update log.').then(() => { setDone(true); setTimeout(() => setDone(false), 2000) })}>{done ? '✓ Copied' : 'Copy details'}</button>
}

/** "Update automatically" on this computer (the user's own choice; the admin can also set it). */
export const autoUpdateOn = () => ls.get('dt-auto-update') === '1'

/**
 * Keeps DeviceTally up to date, from the always-running menu-bar panel. Checks at start and every
 * 3 hours. "Ask" (default): a card with Update now / Later (Later skips that version). Automatic
 * (this computer's setting, or the admin's): downloads, waits until DeviceTally isn't in use,
 * installs and restarts. The admin's "Update now" (read at the 5-minute check-in) installs too.
 * After a restart: "DeviceTally updated to X". A failed install is shown and reported to the admin.
 */
export function UpdateAgent() {
  useEffect(() => {
    let busy = false, asked = '', alive = true
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    // Open at login. On a joined computer (not the admin's) it's required: switched back on at every
    // start. Elsewhere it's on by default once set up, and turning it off in Settings sticks.
    invoke<{ signed_in: boolean; this_device_connected: boolean; local?: boolean }>('status').then((st) => {
      const required = st.this_device_connected && !st.signed_in
      if (!required && (!(st.signed_in || st.local) || ls.get('dt-autostart-default'))) return
      ls.set('dt-autostart-default', '1')
      import('@tauri-apps/plugin-autostart').then((m) => m.isEnabled().then((on) => (on ? undefined : m.enable()))).catch(() => {})
    }, () => {})
    getVersion().then((v) => {
      if (ls.get('dt-updated-to') === v) {
        ls.del('dt-updated-to')
        invoke('show_notice', { title: `DeviceTally updated to ${v}`, body: 'Click to open DeviceTally.', kind: '' })
      }
    }, () => {})
    const install = async (u: Update, waitQuiet: boolean) => {
      if (busy) return
      busy = true
      try {
        while (waitQuiet && alive && await invoke<boolean>('in_use')) await sleep(30_000)
        await invoke('report_update_error', { error: null })
        if (!waitQuiet) invoke('show_notice', { title: `Updating DeviceTally to ${u.version}`, body: 'Downloading… it restarts by itself in a moment.', kind: '' })
        await runUpdate(u)
      } catch (x) {
        const msg = String(x)
        await invoke('report_update_error', { error: msg }).catch(() => {})
        invoke('show_notice', { title: "DeviceTally couldn't update", body: `${updateErrorText(msg)} Details: Settings → App.`, kind: '' })
      } finally { busy = false }
    }
    const run = async () => {
      if (busy || !alive) return
      const [mode, now] = await invoke<[string, number]>('update_policy').catch(() => ['ask', 0] as [string, number])
      const forced = now > Number(ls.get('dt-update-now-done') ?? 0)
      const due = forced || Date.now() - Number(ls.get('dt-update-check') ?? 0) > 3 * 3600_000
      if (!due) return
      const u = await findUpdate(true).catch(() => null)
      if (forced) ls.set('dt-update-now-done', String(now))
      if (!u) return
      if (forced || mode === 'auto' || autoUpdateOn()) return install(u, !forced)
      if (asked !== u.version && ls.get('dt-update-later') !== u.version) {
        asked = u.version
        invoke('show_notice', { title: `DeviceTally ${u.version} is available`, body: 'Update now takes a few seconds.', kind: 'update' })
      }
    }
    const choice = listen<boolean>('dt:update-choice', async (e) => {
      const u = await findUpdate(true).catch(() => null)
      if (!u) return
      if (e.payload) install(u, false)
      else ls.set('dt-update-later', u.version)
    })
    const first = setTimeout(run, 20_000)
    const t = setInterval(run, 5 * 60_000) // follows the check-in, so the admin's "Update now" lands within minutes
    return () => { alive = false; clearTimeout(first); clearInterval(t); choice.then((f) => f()) }
  }, [])
  return null
}

/** One quiet line in the popover when an update is waiting. */
export function UpdateNote({ open }: { open: () => void }) {
  const [v, setV] = useState('')
  useEffect(() => { findUpdate().then((u) => u && setV(u.version), () => {}) }, [])
  if (!v) return null
  return <button class="link-btn" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={open}>Update available: {v} →</button>
}
