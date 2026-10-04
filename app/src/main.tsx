import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import './styles.css'
import { AppTitle, MainWindow } from './window'
import { Mark, modelName } from './brands'
import { UpdateAgent, UpdateNote } from './updates'
import { listen } from '@tauri-apps/api/event'
import { ModulePanel, PANEL_TITLE } from './panels'

type Summary = {
  scope: 'all' | 'device'
  device: { id: string; name: string; chip: number } | null
  by_model: { key: string; label: string; tokens: number; cost: number }[]
  range: { days: number }
  tokens: number
  cost: number
  previous_tokens: number
  by_tool: { key: string; label: string; tokens: number; cost: number }[]
  by_device: { id: string; name: string; chip: number; tokens: number; last_seen: number | null }[]
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en')
const fmt = (n: number) => (n < 10_000 ? whole.format(n) : compact.format(n))
const usd = (n: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(n)
const ago = (ts: number | null) => {
  if (!ts) return 'never'
  const m = (Date.now() - ts) / 60000
  return m < 2 ? 'now' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`
}

// Device chips keep the dashboard's shapes (docs/dev/DESIGN.md motif), drawn in the text colour.
const SHAPES = [
  <circle cx="6" cy="6" r="5" />, <path d="M6 1l5 9H1z" />, <rect x="1.5" y="1.5" width="9" height="9" rx="1" />,
  <path d="M6 .8l5.2 5.2L6 11.2.8 6z" />, <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="2.4" />,
  <rect x="1" y="3.5" width="10" height="5" rx="1" />,
]
const Chip = ({ i }: { i: number }) => <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">{SHAPES[i % 6]}</svg>

const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']] as const

type Stats = { cpu: number; mem_used: number; mem_total: number; disk_free: number; disk_total: number; net_down: number; net_up: number; battery: number | null; charging: boolean; cpu_temp: number | null; uptime: number }
const gb = (b: number) => `${(b / 1e9).toFixed(b >= 100e9 ? 0 : 1)} GB`
const rate = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${Math.round(b / 1e3)} KB/s` : `${Math.round(b)} B/s`)
const uptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`)

type Session = { state: 'working' | 'waiting' | 'done'; since: number; project: string; tool: string }
const STATE_TEXT = { working: 'Working', waiting: 'Needs you', done: 'Done' } as const

// Claude Code on this computer right now: each recent session and what it's doing.
function ClaudeNow() {
  const [list, setList] = useState<Session[]>([])
  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && invoke<Session[]>('activity').then((r) => setList(r ?? []), () => {})
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const recent = list.filter((s) => Date.now() - s.since < (s.state === 'working' ? 3 : 24) * 3600_000).slice(0, 5)
  if (!recent.length) return null
  return (
    <div class="section">
      <h2>Agents now</h2>
      {recent.map((s, i) => (
        <div class="row" key={i}>
          <span class="name"><span class={`sdot ${s.state}`} /><Mark of={s.tool || 'claude'} />{s.project || (s.tool === 'codex' ? 'Codex' : 'Claude Code')}</span>
          <span class="val">{STATE_TEXT[s.state]} · {ago(s.since)}</span>
        </div>
      ))}
    </div>
  )
}

// "This computer": live while the popover is open, nothing read while it's closed.
// One row per reading, with a bar where a share of a whole means something.
function ThisComputer() {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && invoke<Stats>('system_stats').then(setS, () => {})
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  if (!s) return null
  const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0
  const diskUsed = s.disk_total ? ((s.disk_total - s.disk_free) / s.disk_total) * 100 : 0
  const rows: [string, string, number | null][] = [
    ['CPU', `${Math.round(s.cpu)}%`, s.cpu],
    ...(s.cpu_temp ? [['CPU temperature', `${Math.round(s.cpu_temp)} °C`, Math.min(100, s.cpu_temp)] as [string, string, number]] : []),
    ['Memory', `${gb(s.mem_used)} of ${gb(s.mem_total)} · ${Math.round(memPct)}%`, memPct],
    ['Disk', `${gb(s.disk_free)} free of ${gb(s.disk_total)}`, diskUsed],
    ['Network', `↓ ${rate(s.net_down)}   ↑ ${rate(s.net_up)}`, null],
    ...(s.battery !== null ? [['Battery', `${Math.round(s.battery)}% · ${s.charging ? 'charging' : 'on battery'}`, s.battery] as [string, string, number]] : []),
    ['Up for', uptime(s.uptime), null],
  ]
  return (
    <div class="section">
      <h2>This computer</h2>
      <div class="sys">
        {rows.map(([k, v, pct]) => (
          <div key={k} class="sys-row">
            <span>{k}</span><b class="num">{v}</b>
            {pct !== null && <div class="track" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Popover() {
  // Which menu-bar item was clicked: one module's panel, "tokens", or "all" (combined item).
  const [panel, setPanel] = useState('all')
  useEffect(() => {
    invoke<string>('current_panel').then(setPanel, () => {})
    const un = listen<string>('dt:panel', (e) => setPanel(e.payload))
    return () => { un.then((f) => f()) }
  }, [])
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('today')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)

  useEffect(() => {
    let live = true
    const load = () => invoke<Summary>('summary', { range }).then((d) => live && (setData(d), setError('')), (e) => live && setError(String(e)))
    load()
    // Every 30 s while the popover is open (docs/dev/DESIGN.md: freshness); also when it is shown again.
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    const onShow = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onShow)
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [range, n])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && getCurrentWindow().hide()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  // Fixed at the top: who we are, the way into the app, and the range. Only the body scrolls.
  const brand = (
    <div class="pop-brand">
      <div class="pop-id"><AppTitle /></div>
      <div class="pop-actions">
        <button class="pop-act primary" onClick={() => invoke('open_dashboard')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18" /></svg>Open DeviceTally
        </button>
        <button class="pop-act" onClick={() => invoke('open_settings')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>Settings
        </button>
        <button class="pop-act" title="Quit DeviceTally (tracking keeps working)" onClick={() => invoke('quit')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></svg>Quit
        </button>
      </div>
    </div>
  )
  const header = <header class="pop-head">{brand}</header>

  if (PANEL_TITLE[panel]) {
    return (
      <div class="pop">
        <header class="pop-head">{brand}<h1 class="panel-title">{PANEL_TITLE[panel]}</h1></header>
        <div class="pop-body"><ModulePanel panel={panel} /></div>
      </div>
    )
  }

  if (error === 'signed_out' || error === 'not_set_up' || error === 'device_revoked') {
    return (
      <div class="pop">
        {header}
        <div class="state">
          <strong>{error === 'device_revoked' ? 'This computer was disconnected' : 'Connect this computer'}</strong>
          <span>{error === 'device_revoked' ? 'It was removed from your DeviceTally server. Connect it again to see its usage.' : 'Use a code from your DeviceTally admin (Devices, Add device).'}</span>
          <button class="btn primary" onClick={() => invoke('open_settings')}>Connect</button>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div class="pop">
        {header}
        <div class="state" role="alert">
          <strong>{error === 'offline' ? 'Can’t reach your server' : error === 'server_404' ? 'Your server needs an update' : 'Something went wrong'}</strong>
          <span>{error === 'offline' ? 'Check your connection.'
            : error === 'server_404' ? 'It is older than this app. In the worker folder, run: npm run update'
            : error.startsWith('server_') ? `Your server answered ${error.slice(7)}.` : error}</span>
          <button class="btn" onClick={() => setN(n + 1)}>Try again</button></div>
      </div>
    )
  }

  const max = Math.max(1, ...(data?.by_tool ?? []).map((t) => t.tokens))
  const maxModel = Math.max(1, ...(data?.by_model ?? []).map((t) => t.tokens))
  const change = data && data.previous_tokens ? Math.round(((data.tokens - data.previous_tokens) / data.previous_tokens) * 100) : null
  const prevLabel = range === 'today' ? 'yesterday' : range === '7d' ? 'previous 7 days' : 'previous 30 days'

  return (
    <div class="pop">
      <header class="pop-head">
        {brand}
        <div class="seg" role="group" aria-label="Range">
          {RANGES.map(([k, l]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}
        </div>
      </header>
      <div class="pop-body">
      {!data ? (
        <div class="section" aria-label="Loading"><div class="skel" style={{ height: 34, width: '60%' }} /><div class="skel" style={{ height: 12, width: '40%' }} /></div>
      ) : (
        <>
          {data.scope === 'device' && data.device && <div class="section"><h2 style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Chip i={data.device.chip} />{data.device.name}</h2></div>}
          <div class="focal">
            <div class="big num">{fmt(data.tokens)} <span style={{ fontSize: 13, fontWeight: 400 }}>tokens</span></div>
            <div class="sub num">
              {data.cost > 0 && <span title="What this usage would cost at API prices. Subscriptions are a flat fee.">{usd(data.cost)} API-equivalent</span>}
              {change !== null && <span class="trend">{change >= 0 ? '+' : ''}{change}% vs {prevLabel}</span>}
            </div>
          </div>
          <div class="section">
            <h2>By tool</h2>
            {data.by_tool.length ? data.by_tool.map((t) => (
              <div class="row" key={t.key}>
                <span class="name"><Mark of={t.key} />{t.label}</span><span class="val num">{fmt(t.tokens)}</span>
                <div class="track" aria-hidden="true"><div style={{ width: `${(t.tokens / max) * 100}%` }} /></div>
              </div>
            )) : <span class="val">No usage yet {range === 'today' ? 'today' : 'in this range'}.</span>}
          </div>
          {data.by_model.length > 0 && (
            <div class="section">
              <h2>By model</h2>
              {data.by_model.map((m) => (
                <div class="row" key={m.key}>
                  <span class="name" title={m.key}><Mark of={m.key} />{modelName(m.label)}</span><span class="val num">{fmt(m.tokens)}</span>
                  <div class="track" aria-hidden="true"><div style={{ width: `${(m.tokens / maxModel) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          {data.scope === 'all' && <div class="section">
            <h2>Devices</h2>
            {data.by_device.map((d) => (
              <div class="row" key={d.id}>
                <span class="name"><Chip i={d.chip} />{d.name}</span>
                <span class="val num" title={`Last seen ${ago(d.last_seen)}`}>{fmt(d.tokens)} · <span class={`health ${!d.last_seen ? 'offline' : Date.now() - d.last_seen < 15 * 60000 ? 'online' : Date.now() - d.last_seen < 86400000 ? 'idle' : 'offline'}`}><i />{ago(d.last_seen)}</span></span>
              </div>
            ))}
          </div>}
        </>
      )}
      {panel === 'all' && <><ClaudeNow /><ThisComputer /></>}
      <UpdateNote open={() => invoke('open_settings')} />
      <p class="note">Updates every 30 s</p>
      </div>
    </div>
  )
}

/** DeviceTally's own notification (macOS refuses system ones for apps without a paid signature). */
function NoticeCard() {
  const q = new URLSearchParams(location.search)
  const [n, setN] = useState<{ title: string; body: string; kind?: string } | null>(q.get('t') ? { title: q.get('t')!, body: q.get('b') ?? '', kind: q.get('k') ?? '' } : null)
  useEffect(() => { const u = listen<{ title: string; body: string; kind?: string }>('dt:card', (e) => setN(e.payload)); return () => { u.then((f) => f()) } }, [])
  if (!n) return null
  if (n.kind === 'update') return (
    <div class="dt-card" role="alert">
      <img src="/icon.png" alt="" />
      <div><b>{n.title}</b><span>{n.body}</span></div>
      <span class="dt-card-btns">
        <button class="dt-card-btn primary" onClick={() => invoke('card_update', { install: true })}>Update now</button>
        <button class="dt-card-btn" onClick={() => invoke('card_update', { install: false })}>Later</button>
      </span>
    </div>
  )
  return (
    <div class="dt-card" role="alert" onClick={() => invoke('card_action', { open: true })}>
      <img src="/icon.png" alt="" />
      <div><b>{n.title}</b><span>{n.body}</span></div>
      <button class="dt-card-x" aria-label="Close" onClick={(e) => { e.stopPropagation(); invoke('card_action', { open: false }) }}>✕</button>
    </div>
  )
}

const view = new URLSearchParams(location.search).get('view')
// The update logic lives beside the menu-bar panel (always loaded, whichever panel shows).
render(view === 'main' ? <MainWindow /> : view === 'card' ? <NoticeCard /> : <><Popover /><UpdateAgent /></>, document.getElementById('app')!)
