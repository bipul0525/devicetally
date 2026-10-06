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
    try { return localStorage.getItem('dt-update-available') ? await check() : null } catch { return null }
  }
  const u = await check()
  try {
    localStorage.setItem('dt-update-check', String(Date.now()))
    u ? localStorage.setItem('dt-update-available', u.version) : localStorage.removeItem('dt-update-available')
  } catch {}
  return u
}

export function AppGroup() {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'error'>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => { getVersion().then(setVersion) }, [])

  const doCheck = async () => {
    setState('checking'); setErr('')
    try {
      const u = await findUpdate(true)
      setUpdate(u); setState(u ? 'available' : 'none')
    } catch (x) { setErr(String(x)); setState('error') }
  }
  const install = async () => {
    if (!update) return
    setState('downloading'); setProgress(0)
    let total = 0, got = 0
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0
        if (e.event === 'Progress') { got += e.data.chunkLength; if (total) setProgress(Math.round((got / total) * 100)) }
      })
      try { localStorage.removeItem('dt-update-available') } catch {}
      await relaunch()
    } catch (x) { setErr(String(x)); setState('error') }
  }

  return (
    <section class="section"><h2>App</h2>
      <div class="group">
        <div class="field"><span>DeviceTally {version}</span>
          {state === 'available' || state === 'downloading' ? null
            : <button class="btn" disabled={state === 'checking'} onClick={doCheck}>{state === 'checking' ? 'Checking…' : 'Check for updates'}</button>}
        </div>
        {state === 'none' && <div class="field"><span class="val">You have the latest version.</span></div>}
        <AutoUpdateToggle />
        <DockToggle />
        {(state === 'available' || state === 'downloading') && update && (
          <>
            <div class="field"><span><b>Version {update.version} is available</b></span>
              <button class="btn primary" disabled={state === 'downloading'} onClick={install}>{state === 'downloading' ? `Updating… ${progress}%` : 'Update and restart'}</button>
            </div>
            {update.body && <p class="hint" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto', margin: '0 0 8px' }} tabIndex={0}>{update.body.replace(/```[\s\S]*?```/g, '').slice(0, 600)}</p>}
          </>
        )}
      </div>
      {err && <p class="err" role="alert">Update failed: {err}</p>}
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
        await u.downloadAndInstall()
        ls.set('dt-updated-to', u.version); ls.del('dt-update-available')
        await invoke('report_update_error', { error: null })
        await relaunch()
      } catch (x) {
        const msg = String(x)
        await invoke('report_update_error', { error: msg }).catch(() => {})
        invoke('show_notice', { title: "DeviceTally couldn't update", body: /permission|denied|not permitted|read-only/i.test(msg) ? 'This account can\'t install apps here. Ask an admin of this computer.' : msg.slice(0, 120), kind: '' })
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
