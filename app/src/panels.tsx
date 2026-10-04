// One panel per menu-bar item (like Stats): clicking Network shows only network, and so on.
// Live while open (every 2 s), nothing read while closed.
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Mark } from './brands'

export type Stats = {
  cpu: number; mem_used: number; mem_total: number; disk_free: number; disk_total: number; net_down: number; net_up: number; net_total_down: number; net_total_up: number
  battery: number | null; charging: boolean; cpu_temp: number | null; uptime: number
  net_iface: string; local_ip: string; battery_health: number | null; battery_cycles: number | null; battery_watts: number | null; battery_minutes: number | null
}
type Point = { t: number; cpu: number; down: number; up: number; mem: number; temp: number | null }
type Proc = { name: string; cpu: number; mem: number }
type Session = { state: 'working' | 'waiting' | 'done'; since: number; project: string; tool: string; started: number; prompt: string }
type Finished = { at: number; took: number; project: string; tool: string; prompt: string }

const gb = (b: number) => `${(b / 1e9).toFixed(b >= 100e9 ? 0 : 1)} GB`
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
const gbs = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(b >= 100e9 ? 0 : 2)} GB` : `${Math.round(b / 1e6)} MB`)
const rate = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${Math.round(b / 1e3)} KB/s` : `${Math.round(b)} B/s`)
const ago = (ts: number) => { const m = (Date.now() - ts) / 60000; return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : `${Math.round(m / 60)} h ago` }
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

/** Live stats, history and (optionally) top processes, refreshed every 2 s while visible. */
function useLive(procs?: 'cpu' | 'mem') {
  const [s, setS] = useState<Stats | null>(null)
  const [h, setH] = useState<Point[]>([])
  const [p, setP] = useState<Proc[]>([])
  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== 'visible') return
      invoke<Stats>('system_stats').then(setS, () => {})
      invoke<Point[]>('stats_history').then(setH, () => {})
      if (procs) invoke<Proc[]>('top_processes', { by: procs }).then(setP, () => {})
    }
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [procs])
  return { s, h, p }
}

/** A small area chart of recent values (newest on the right). */
function Spark({ values, max, color, label }: { values: number[]; max?: number; color: string; label: string }) {
  const W = 300, H = 54
  const top = Math.max(max ?? 0, ...values, 1e-9)
  const pts = values.slice(-90)
  const x = (i: number) => (pts.length < 2 ? W : (i / (pts.length - 1)) * W)
  const y = (v: number) => H - (v / top) * (H - 4)
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {pts.length > 1 && <path d={`${line}L${W},${H}L0,${H}Z`} fill={color} opacity="0.22" />}
      {pts.length > 1 && <path d={line} fill="none" stroke={color} stroke-width="1.6" vector-effect="non-scaling-stroke" />}
    </svg>
  )
}

const Row = ({ k, v }: { k: ComponentChildren; v: ComponentChildren }) => <div class="prow"><span>{k}</span><b class="num">{v}</b></div>
const Bar = ({ pct, color }: { pct: number; color?: string }) => <div class="track"><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>

function Processes({ list, by }: { list: Proc[]; by: 'cpu' | 'mem' }) {
  if (!list.length) return null
  return (
    <div class="section"><h2>Top processes</h2>
      {list.map((p) => <Row key={p.name + p.mem} k={p.name} v={by === 'cpu' ? `${p.cpu.toFixed(1)}%` : mb(p.mem)} />)}
    </div>
  )
}

type NetDetails = { checks: (number | null)[]; latency: number | null; jitter: number | null; dns: string[]; mac: string; total_down: number; total_up: number; reset: boolean }
type PublicIp = { ip?: string; country?: string; city?: string; org?: string }
type NetApp = { name: string; down: number; up: number }
const flag = (cc?: string) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '')

/** Upload above the line, download below it, like Stats. */
function Mirror({ down, up }: { down: number[]; up: number[] }) {
  const W = 300, H = 76, M = H / 2
  const d = down.slice(-90), u = up.slice(-90)
  const top = Math.max(1, ...u), bot = Math.max(1, ...d)
  const x = (i: number, n: number) => (n < 2 ? W : (i / (n - 1)) * W)
  const area = (v: number[], max: number, dir: 1 | -1) => v.length < 2 ? '' : `M0,${M}` + v.map((y, i) => `L${x(i, v.length).toFixed(1)},${(M - dir * (y / max) * (M - 2)).toFixed(1)}`).join('') + `L${W},${M}Z`
  return (
    <div class="mirror">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Upload and download history">
        <path d={area(u, top, 1)} fill="#ff9f0a" opacity="0.75" />
        <path d={area(d, bot, -1)} fill="#5e5ce6" opacity="0.8" />
        <line x1="0" x2={W} y1={M} y2={M} stroke="currentColor" opacity="0.25" stroke-width="0.6" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="mirror-top">↑ {rate(top)}</span><span class="mirror-bot">↓ {rate(bot)}</span>
    </div>
  )
}

function NetPanel() {
  const { s, h } = useLive()
  const [d, setD] = useState<NetDetails | null>(null)
  const [apps, setApps] = useState<NetApp[]>([])
  const [pub, setPub] = useState<PublicIp | null>(null)
  const loadPub = (refresh: boolean) => invoke<PublicIp>('public_ip', { refresh }).then(setPub, () => setPub({}))
  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== 'visible') return
      invoke<NetDetails>('net_details').then(setD, () => {})
      invoke<NetApp[]>('net_processes').then(setApps, () => {})
    }
    load(); loadPub(false)
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  if (!s) return null
  const cells = [...Array(Math.max(0, 90 - (d?.checks.length ?? 0))).fill(undefined), ...(d?.checks ?? [])]
  const online = d && d.checks.length ? d.checks[d.checks.length - 1] != null : null
  return <>
    <div class="big2">
      <div><span><span class="dot-down" />Download</span><b class="num">{rate(s.net_down)}</b></div>
      <div><span><span class="dot-up" />Upload</span><b class="num">{rate(s.net_up)}</b></div>
    </div>
    <div class="section"><h2>Usage history</h2><Mirror down={h.map((p) => p.down)} up={h.map((p) => p.up)} /></div>
    <div class="section"><h2>Connectivity</h2>
      <div class="conn" role="img" aria-label="Connectivity over the last 3 minutes">{cells.map((c, i) => <i key={i} class={c === undefined ? '' : c === null ? 'down' : 'up'} />)}</div>
      <Row k="Internet" v={online == null ? 'checking…' : online ? <span class="ok">● Connected</span> : <span class="bad">● No connection</span>} />
      <Row k="Latency" v={d?.latency != null ? `${Math.round(d.latency)} ms` : '—'} />
      <Row k="Jitter" v={d?.jitter != null ? `${Math.round(d.jitter)} ms` : '—'} />
    </div>
    <div class="section"><h2 class="h-act">Usage<button class="icon-btn small" title="Start the totals from zero" aria-label="Reset totals" onClick={() => invoke('reset_net_totals').then(() => invoke<NetDetails>('net_details').then(setD))}>↻</button></h2>
      <Row k={<><span class="dot-up" />Total upload</>} v={gbs(d?.total_up ?? s.net_total_up)} />
      <Row k={<><span class="dot-down" />Total download</>} v={gbs(d?.total_down ?? s.net_total_down)} />
      <div class="hint" style={{ margin: 0 }}>{d?.reset ? 'Since you reset it.' : 'Since the computer started.'}</div>
    </div>
    <div class="section"><h2>Details</h2>
      <Row k="Interface" v={s.net_iface || '—'} />
      {d?.mac && <Row k="MAC address" v={d.mac} />}
      <Row k="Local IP" v={s.local_ip || '—'} />
      <Row k="Public IP" v={pub == null ? '…' : pub.ip ? <button class="link-btn" title="Refresh" onClick={() => loadPub(true)}>{flag(pub.country)} {pub.ip}</button> : '—'} />
      {pub?.org && <Row k="Provider" v={pub.org.replace(/^AS\d+\s*/, '')} />}
      {pub?.city && <Row k="Location" v={`${pub.city}${pub.country ? `, ${pub.country}` : ''}`} />}
      {d && d.dns.length > 0 && <Row k="DNS" v={d.dns.join(', ')} />}
    </div>
    {apps.length > 0 && <div class="section"><h2>Apps using the network</h2>
      {apps.map((a) => <div class="prow" key={a.name}><span>{a.name}</span><b class="num">↓ {rate(a.down)}  ↑ {rate(a.up)}</b></div>)}
    </div>}
  </>
}

function CpuPanel() {
  const { s, h, p } = useLive('cpu')
  if (!s) return null
  return <>
    <div class="big2">
      <div>CPU<b class="num">{Math.round(s.cpu)}%</b></div>
      {s.cpu_temp != null && <div>Temperature<b class="num">{Math.round(s.cpu_temp)} °C</b></div>}
    </div>
    <Spark values={h.map((x) => x.cpu)} max={100} color="#0a84ff" label="CPU history" />
    {h.some((x) => x.temp != null) && <Spark values={h.map((x) => x.temp ?? 0)} max={100} color="#ff9f0a" label="Temperature history" />}
    <Processes list={p} by="cpu" />
  </>
}

function MemPanel() {
  const { s, h, p } = useLive('mem')
  if (!s) return null
  const pct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0
  return <>
    <div class="big2"><div>Memory used<b class="num">{Math.round(pct)}%</b></div><div>Of<b class="num">{gb(s.mem_total)}</b></div></div>
    <Bar pct={pct} />
    <Spark values={h.map((x) => x.mem)} max={100} color="#bf5af2" label="Memory history" />
    <div class="section"><Row k="Used" v={gb(s.mem_used)} /><Row k="Free" v={gb(s.mem_total - s.mem_used)} /></div>
    <Processes list={p} by="mem" />
  </>
}

function DiskPanel() {
  const { s } = useLive()
  if (!s) return null
  const used = s.disk_total ? ((s.disk_total - s.disk_free) / s.disk_total) * 100 : 0
  return <>
    <div class="big2"><div>Free<b class="num">{gb(s.disk_free)}</b></div><div>Used<b class="num">{Math.round(used)}%</b></div></div>
    <Bar pct={used} color={used >= 90 ? '#ff453a' : used >= 80 ? '#ff9f0a' : undefined} />
    <div class="section"><Row k="Total" v={gb(s.disk_total)} /><Row k="Used" v={gb(s.disk_total - s.disk_free)} /></div>
    <button class="btn primary wide" onClick={() => invoke('open_tab', { tab: 'storage' })}>What's using space?</button>
  </>
}

function BatteryPanel() {
  const { s } = useLive()
  if (!s) return null
  if (s.battery == null) return <p class="hint">This computer has no battery.</p>
  return <>
    <div class="big2"><div>{s.charging ? 'Charging' : 'On battery'}<b class="num">{Math.round(s.battery)}%</b></div>
      {s.battery_minutes != null && <div>{s.charging ? 'Until full' : 'Remaining'}<b class="num">{mins(s.battery_minutes)}</b></div>}</div>
    <Bar pct={s.battery} color={s.battery <= 20 && !s.charging ? '#ff453a' : '#30d158'} />
    <div class="section">
      {s.battery_health != null && <Row k="Health" v={`${Math.round(s.battery_health)}%`} />}
      {s.battery_cycles != null && <Row k="Cycles" v={s.battery_cycles} />}
      {s.battery_watts != null && <Row k="Power" v={`${s.battery_watts.toFixed(1)} W`} />}
      <Row k="Up for" v={`${Math.floor(s.uptime / 86400)} d ${Math.floor((s.uptime % 86400) / 3600)} h`} />
    </div>
  </>
}

function ClockPanel() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7 // weeks start on Monday
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)]
  return <>
    <div class="clock-big num">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>
    <div class="hint" style={{ textAlign: 'center', margin: 0 }}>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="cal">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={'h' + i} class="cal-h">{d}</span>)}
      {cells.map((d, i) => <span key={i} class={d === now.getDate() ? 'today' : ''}>{d || ''}</span>)}
    </div>
  </>
}

const clock = (ms: number) => { const t = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s` }
const toolName = (t: string) => (t === 'codex' ? 'Codex' : 'Claude Code')

function AgentPanel() {
  const [list, setList] = useState<Session[]>([])
  const [log, setLog] = useState<Finished[]>([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== 'visible') return
      invoke<Session[]>('activity').then((r) => setList(r ?? []), () => {})
      invoke<Finished[]>('agent_history').then((r) => setLog(r ?? []), () => {})
    }
    load()
    const t = setInterval(load, 2000)
    const c = setInterval(() => setNow(Date.now()), 1000) // live timers
    return () => { clearInterval(t); clearInterval(c) }
  }, [])
  const live = list.filter((s) => s.state !== 'done' && now - s.since < 6 * 3600_000)
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const today = log.filter((f) => f.at >= midnight)
  const spent = today.reduce((a, f) => a + f.took, 0)
  return <>
    <div class="ag-sum">
      <div><b class="num">{live.filter((s) => s.state === 'working').length}</b><span>working</span></div>
      <div><b class="num">{today.length}</b><span>done today</span></div>
      <div><b class="num">{spent ? clock(spent) : '—'}</b><span>agent time today</span></div>
    </div>
    {live.length > 0 && <div class="section"><h2>Now</h2>
      {live.map((s) => (
        <div class={`ag-card ${s.state}`} key={s.project + s.since}>
          <span class={`ag-ind ${s.state}`} aria-hidden="true">{s.state === 'waiting' ? '!' : ''}</span>
          <div class="ag-body">
            <div class="ag-top"><Mark of={s.tool || 'claude'} /><b>{s.project || toolName(s.tool)}</b>
              <span class="ag-time num">{s.state === 'working' ? clock(now - (s.started || s.since)) : 'needs you'}</span></div>
            {s.prompt ? <div class="ag-prompt">{s.prompt}</div> : <div class="ag-prompt muted">{s.state === 'working' ? `${toolName(s.tool)} is working…` : 'Waiting for a permission or an answer.'}</div>}
          </div>
        </div>
      ))}
    </div>}
    <div class="section"><h2>Recent</h2>
      {log.length === 0
        ? <p class="hint" style={{ margin: 0 }}>{live.length ? 'Finished tasks show up here.' : "No agents running. Start Claude Code (terminal, VS Code or another editor) or Codex, and this shows what they're doing and what they finished."}</p>
        : log.slice(0, 12).map((f, i) => (
          <div class="ag-row" key={f.at + '-' + i}>
            <span class="ag-check" aria-hidden="true">✓</span>
            <div class="ag-body"><div class="ag-top"><Mark of={f.tool || 'claude'} /><b>{f.project || toolName(f.tool)}</b><span class="ag-time">{ago(f.at)}</span></div>
              {f.prompt && <div class="ag-prompt">{f.prompt}</div>}
              {f.took > 0 && <div class="ag-took num">took {clock(f.took)}</div>}</div>
          </div>
        ))}
    </div>
  </>
}

export const PANEL_TITLE: Record<string, string> = { agent: 'Agents', net: 'Network', cpu: 'CPU', temp: 'CPU', mem: 'Memory', disk: 'Disk', battery: 'Battery', clock: 'Clock' }

/** The panel for one menu-bar item, or null for "all" / "tokens" (the usage popover). */
export function ModulePanel({ panel }: { panel: string }) {
  switch (panel) {
    case 'agent': return <AgentPanel />
    case 'net': return <NetPanel />
    case 'cpu': case 'temp': return <CpuPanel />
    case 'mem': return <MemPanel />
    case 'disk': return <DiskPanel />
    case 'battery': return <BatteryPanel />
    case 'clock': return <ClockPanel />
    default: return null
  }
}
