import { invoke } from '@tauri-apps/api/core'
// In-app updates: the app checks the latest release's latest.json, downloads the update for this
// platform, verifies its signature (key in tauri.conf.json) and restarts. No browser download, so
// macOS never shows "damaged".
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { useEffect, useState } from 'preact/hooks'

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

/** One quiet line in the popover when an update is waiting. */
export function UpdateNote({ open }: { open: () => void }) {
  const [v, setV] = useState('')
  useEffect(() => { findUpdate().then((u) => u && setV(u.version), () => {}) }, [])
  if (!v) return null
  return <button class="link-btn" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={open}>Update available: {v} →</button>
}
