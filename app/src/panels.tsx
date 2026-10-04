// One panel per menu-bar item (like Stats): clicking Network shows only network, and so on.
// Live while open (every 2 s), nothing read while closed.
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Mark } from './brands'

export type Stats = {
  cpu: number; mem_used: number; mem_total: number; disk_free: number; disk_total: number; net_down: number; net_up: number
  battery: number | null; charging: boolean; cpu_temp: number | null; uptime: number
  net_iface: string; local_ip: string; battery_health: number | null; battery_cycles: number | null; battery_watts: number | null; battery_minutes: number | null
}
type Point = { t: number; cpu: number; down: number; up: number; mem: number; temp: number | null }
type Proc = { name: string; cpu: number; mem: number }
type Session = { state: 'working' | 'waiting' | 'done'; since: number; project: string; tool: string }

const gb = (b: number) => `${(b / 1e9).toFixed(b >= 100e9 ? 0 : 1)} GB`
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
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

const Row = ({ k, v }: { k: string; v: ComponentChildren }) => <div class="prow"><span>{k}</span><b class="num">{v}</b></div>
const Bar = ({ pct, color }: { pct: number; color?: string }) => <div class="track"><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>

function Processes({ list, by }: { list: Proc[]; by: 'cpu' | 'mem' }) {
  if (!list.length) return null
  return (
    <div class="section"><h2>Top processes</h2>
      {list.map((p) => <Row key={p.name + p.mem} k={p.name} v={by === 'cpu' ? `${p.cpu.toFixed(1)}%` : mb(p.mem)} />)}
    </div>
  )
}

function NetPanel() {
  const { s, h } = useLive()
  if (!s) return null
  return <>
    <div class="big2">
      <div><span><span class="dot-down" />Download</span><b class="num">{rate(s.net_down)}</b></div>
      <div><span><span class="dot-up" />Upload</span><b class="num">{rate(s.net_up)}</b></div>
    </div>
    <Spark values={h.map((p) => p.down)} color="#0a84ff" label="Download history" />
    <Spark values={h.map((p) => p.up)} color="#ff453a" label="Upload history" />
    <div class="section"><h2>Connection</h2>
      <Row k="Interface" v={s.net_iface || '—'} />
      <Row k="Local IP" v={s.local_ip || '—'} />
    </div>
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

function AgentPanel() {
  const [list, setList] = useState<Session[]>([])
  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && invoke<Session[]>('activity').then((r) => setList(r ?? []), () => {})
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const recent = list.filter((s) => Date.now() - s.since < 24 * 3600_000).slice(0, 8)
  const word = { working: 'Working', waiting: 'Needs you', done: 'Done' } as const
  if (!recent.length) return <p class="hint">No agents running. Start Claude Code (terminal, VS Code or another editor) or Codex, and this shows what they're doing.</p>
  return (
    <div class="section">
      {recent.map((s, i) => (
        <div class="row" key={i}>
          <span class="name"><span class={`sdot ${s.state}`} /><Mark of={s.tool || 'claude'} />{s.project || (s.tool === 'codex' ? 'Codex' : 'Claude Code')}</span>
          <span class="val">{word[s.state]} · {ago(s.since)}</span>
        </div>
      ))}
    </div>
  )
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
