import { Hono } from 'hono'
import type { Env } from './auth'
import { dayOf, ownerTimezone } from './days'
import { PRICES } from './prices'
import { rebuildRollups } from './rollup'
import { TOOLS } from './tools'

// Read-only dashboard queries. Charts read only the rollup tables (docs/dev/PLAN.md §7).
export const dashboard = new Hono<Env>()

type Filters = { from: string; to: string; device?: string; account?: string; project?: string; model?: string; effort?: string; tool?: string }
const DIMS = ['device', 'account', 'project', 'model', 'effort'] as const
const COL = { device: 'device_id', account: 'account_uuid', project: 'project_key', model: 'model', effort: 'effort' } as const

// Handlers below serve both the admin (/api/*, any device) and a connected machine (/api/v1/*, device key):
// with a device key, `scopedDevice` forces every query to that one device.
type Ctx = { req: { query: (k: string) => string | undefined; param: (k: string) => string }; env: Env['Bindings']; get: (k: 'deviceId') => string | undefined; json: (b: unknown, s?: number) => Response }
const scopedDevice = (c: Ctx) => c.get('deviceId') || undefined

async function filters(c: Ctx): Promise<Filters> {
  const q = (k: string) => (k === 'device' && scopedDevice(c)) || c.req.query(k) || undefined
  const today = dayOf(Date.now(), await ownerTimezone(c.env.DB))
  const day = /^\d{4}-\d{2}-\d{2}$/
  const to = q('to')?.match(day) ? q('to')! : today
  // `days` counts back from today in the owner's timezone (the browser's clock may be in another zone).
  const days = Math.min(Math.max(Number(q('days')) || 30, 1), 3660)
  const from = q('from')?.match(day) ? q('from')! : shiftDay(to, -(days - 1))
  return { from, to, device: q('device'), account: q('account'), project: q('project'), model: q('model'), effort: q('effort'), tool: q('tool') }
}

export const shiftDay = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)

/** WHERE clause over a rollup-shaped table. `dims` limits which filters apply (hourly_activity has no model/effort). */
function where(f: Filters, dims: readonly (typeof DIMS)[number][] = DIMS, from = f.from, to = f.to) {
  const sql = ['day BETWEEN ? AND ?']
  const args: string[] = [from, to]
  for (const d of dims) {
    if (f[d] === undefined) continue
    sql.push(`${COL[d]} = ?`)
    args.push(f[d]!)
  }
  return { sql: sql.join(' AND '), args }
}

// 1-hour cache writes are priced higher; without that split the estimate ran ~9% under ccusage.
const cost = (model: string, r: { in_tok: number; out_tok: number; cache_write_tok: number; cache_read_tok: number; cache_write_1h_tok?: number }) => {
  const p = PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')]
  if (!p) return null
  const oneHour = r.cache_write_1h_tok ?? 0
  return (r.in_tok * p[0] + r.out_tok * p[1] + (r.cache_write_tok - oneHour) * p[2] + oneHour * p[4] + r.cache_read_tok * p[3]) / 1e6
}

type Row = {
  tool?: string
  day: string; device_id: string; account_uuid: string; project_key: string; model: string; effort: string
  in_tok: number; out_tok: number; cache_write_tok: number; cache_read_tok: number; cache_write_1h_tok: number; thinking_tok: number
  turns: number; prompts: number; sessions: number; active_seconds: number
}
const SUMS = ['in_tok', 'out_tok', 'cache_write_tok', 'cache_read_tok', 'cache_write_1h_tok', 'thinking_tok', 'turns', 'prompts', 'sessions', 'active_seconds'] as const
type Totals = Record<(typeof SUMS)[number] | 'tokens' | 'cost', number>
const empty = (): Totals => Object.fromEntries([...SUMS, 'tokens', 'cost'].map((k) => [k, 0])) as Totals

function totalsOf(rows: Row[], unpriced: Set<string>) {
  const t = empty()
  for (const r of rows) add(t, r, unpriced)
  return t
}
function add(t: Totals, r: Row, unpriced: Set<string>) {
  for (const k of SUMS) t[k] += r[k]
  t.tokens += r.in_tok + r.out_tok + r.cache_write_tok + r.cache_read_tok
  if (r.model) {
    const c = cost(r.model, r)
    if (c === null) unpriced.add(r.model)
    else t.cost += c
  }
}

export const overview = async (c: Ctx) => {
  const f = await filters(c)
  const db = c.env.DB
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86400_000 + 1
  const w = where(f)
  const pw = where(f, DIMS, shiftDay(f.from, -days), shiftDay(f.from, -1))
  const hw = where(f, ['device', 'account', 'project'])
  // Claude Code comes from the detailed rollups; other tools from tool_daily (no accounts, projects or effort).
  const claudeOn = !f.tool || f.tool === 'claude'
  const toolsOn = f.tool !== 'claude' && !f.account && !f.project && !f.effort
  const tw = (from: string, to: string) => {
    const sql = ['day BETWEEN ? AND ?']
    const args = [from, to]
    for (const [k, col] of [['device', 'device_id'], ['model', 'model'], ['tool', 'tool']] as const) if (f[k]) (sql.push(`${col} = ?`), args.push(f[k]!))
    return db.prepare(`SELECT day, device_id, tool, model, sum(in_tok) in_tok, sum(out_tok) out_tok, sum(cache_read_tok) cache_read_tok,
      sum(cache_write_tok) cache_write_tok, sum(reasoning_tok) reasoning_tok, sum(messages) messages
      FROM tool_daily WHERE ${sql.join(' AND ')} GROUP BY day, device_id, tool, model`).bind(...args)
  }
  const [cur, prev, hours, devices, accounts, projects, tcur, tprev, seen] = await db.batch([
    db.prepare(`SELECT * FROM daily_rollup WHERE ${w.sql}`).bind(...w.args),
    db.prepare(`SELECT * FROM daily_rollup WHERE ${pw.sql}`).bind(...pw.args),
    db.prepare(`SELECT day, hour, sum(turns) turns, sum(prompts) prompts FROM hourly_activity WHERE ${hw.sql} GROUP BY day, hour`).bind(...hw.args),
    db.prepare('SELECT id, name, os, created_at, revoked_at FROM devices ORDER BY created_at'),
    db.prepare('SELECT uuid, email, display_name, plan, status FROM accounts'),
    db.prepare('SELECT key, display_name FROM projects'),
    tw(f.from, f.to),
    tw(shiftDay(f.from, -days), shiftDay(f.from, -1)),
    db.prepare('SELECT DISTINCT tool FROM tools_seen'),
  ])
  type T = { day: string; device_id: string; tool: string; model: string; in_tok: number; out_tok: number; cache_read_tok: number; cache_write_tok: number; reasoning_tok: number; messages: number }
  const fromTool = (t: T): Row => ({
    tool: t.tool, day: t.day, device_id: t.device_id, account_uuid: '', project_key: '', model: t.model, effort: '',
    in_tok: t.in_tok, out_tok: t.out_tok, cache_write_tok: t.cache_write_tok, cache_read_tok: t.cache_read_tok, cache_write_1h_tok: 0,
    thinking_tok: t.reasoning_tok, turns: t.messages, prompts: 0, sessions: 0, active_seconds: 0,
  })
  const merge = (claude: Row[], tools: T[]) => [
    ...(claudeOn ? claude.map((r) => ({ ...r, tool: 'claude' })) : []),
    ...(toolsOn ? tools.map(fromTool) : []),
  ]
  const rows = merge(cur.results as Row[], tcur.results as T[])
  const unpriced = new Set<string>()
  const by: Record<string, Map<string, Totals>> = Object.fromEntries([...DIMS, 'tool'].map((d) => [d, new Map()]))
  const daily = new Map<string, Totals>()
  for (const r of rows) {
    for (const d of [...DIMS, 'tool'] as const) {
      const key = d === 'tool' ? r.tool! : r[COL[d]]
      if (d !== 'tool' && d !== 'device' && !key) continue // prompt/session rows carry no model; tools carry no account/project/effort
      let t = by[d].get(key)
      if (!t) by[d].set(key, (t = empty()))
      add(t, r, unpriced)
    }
    let t = daily.get(r.day)
    if (!t) daily.set(r.day, (t = empty()))
    add(t, r, unpriced)
  }
  // Day-by-hour grid: weekday (0 = Monday) x hour.
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0))
  // Other tools report daily totals only, so the day-by-hour grid is Claude Code's.
  for (const h of claudeOn ? (hours.results as { day: string; hour: number; turns: number; prompts: number }[]) : []) {
    heat[(new Date(h.day + 'T00:00:00Z').getUTCDay() + 6) % 7][h.hour] += h.turns + h.prompts
  }
  // Entries with no tokens and no activity (e.g. tokscale messages that carried no usage) are noise.
  const list = (m: Map<string, Totals>) => [...m.entries()].map(([key, t]) => ({ key, ...t }))
    .filter((t) => t.tokens > 0 || t.prompts > 0 || t.sessions > 0)
    .sort((a, b) => b.tokens - a.tokens)
  return c.json({
    range: { from: f.from, to: f.to, days },
    totals: totalsOf(rows, unpriced),
    previous: totalsOf(merge(prev.results as Row[], tprev.results as T[]), new Set()),
    daily: [...Array(days).keys()].map((i) => {
      const day = shiftDay(f.from, i)
      return { day, ...(daily.get(day) ?? empty()) }
    }),
    by: Object.fromEntries([...DIMS, 'tool'].map((d) => [d, list(by[d])])),
    heat,
    unpriced: [...unpriced],
    labels: scopedDevice(c) ? {
      // A connected machine sees only its own name, and only accounts/projects present in its own data.
      devices: (devices.results as { id: string }[]).filter((d) => d.id === scopedDevice(c)),
      accounts: (accounts.results as { uuid: string }[]).filter((a) => by.account.has(a.uuid)),
      projects: (projects.results as { key: string }[]).filter((p) => by.project.has(p.key)),
      tools: { claude: 'Claude Code', ...TOOLS },
      tools_seen: [...by.tool.keys()].filter((t) => t !== 'claude'),
    } : {
      devices: devices.results, accounts: accounts.results, projects: projects.results,
      tools: { claude: 'Claude Code', ...TOOLS },
      tools_seen: (seen.results as { tool: string }[]).map((r) => r.tool),
    },
  })
}
dashboard.get('/overview', (c) => overview(c as unknown as Ctx))

export const sessions = async (c: Ctx) => {
  const f = await filters(c)
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER
  const w = where(f, ['device', 'account', 'project'])
  const r = await c.env.DB.prepare(
    `WITH page AS (
       SELECT * FROM sessions WHERE ${w.sql} AND started_at < ? ORDER BY started_at DESC LIMIT 50
     )
     SELECT page.id, page.device_id, page.account_uuid, page.project_key, page.title, page.git_branch, page.entrypoint,
            page.started_at, page.ended_at, page.active_seconds,
            (SELECT coalesce(sum(in_tok + out_tok + cache_write_tok + cache_read_tok), 0) FROM turns WHERE session_id = page.id) tokens,
            (SELECT count(*) FROM prompts WHERE session_id = page.id) prompts
     FROM page ORDER BY started_at DESC`,
  ).bind(...w.args, before).all()
  return c.json(r.results)
}
dashboard.get('/sessions', (c) => sessions(c as unknown as Ctx))

// Session timeline: replies with tokens and model, and when each prompt was sent, but never prompt text.
// Text is only at /api/sessions/:id/prompts, which exists for the admin alone.
export const sessionDetail = async (c: Ctx) => {
  const id = c.req.param('id')
  const db = c.env.DB
  const [s, prompts, turns] = await db.batch([
    db.prepare(`SELECT id, device_id, account_uuid, project_key, title, git_branch, entrypoint, cc_version, started_at, ended_at, active_seconds FROM sessions WHERE id = ?${scopedDevice(c) ? ' AND device_id = ?' : ''}`).bind(...(scopedDevice(c) ? [id, scopedDevice(c)!] : [id])),
    db.prepare('SELECT id, ts FROM prompts WHERE session_id = ? ORDER BY ts').bind(id),
    db.prepare('SELECT id, ts, model, effort, in_tok, out_tok, cache_write_tok, cache_read_tok, cache_write_1h_tok, thinking_tok, is_subagent FROM turns WHERE session_id = ? ORDER BY ts').bind(id),
  ])
  if (!s.results.length) return c.json({ error: 'not_found' }, 404)
  const turnRows = (turns.results as (Row & { id: string; ts: number })[]).map((t) => ({ ...t, cost: t.model ? cost(t.model, t) : null }))
  return c.json({ session: s.results[0], prompts: prompts.results, turns: turnRows })
}
dashboard.get('/sessions/:id', (c) => sessionDetail(c as unknown as Ctx))
dashboard.get('/sessions/:id/prompts', async (c) =>
  c.json((await c.env.DB.prepare('SELECT id, ts, text FROM prompts WHERE session_id = ? ORDER BY ts').bind(c.req.param('id')).all()).results))

// Compact numbers for the tray app: tokens and cost by tool, model and device for today / 7 days / 30 days
// (owner's time zone) plus the previous period. With `deviceId`, only that device (the tray app on a
// connected machine sees its own usage, never other machines'). No prompts, nothing per session.
export async function summarize(db: D1Database, rangeParam: string | undefined, deviceId?: string) {
  const range = rangeParam === '30d' ? 30 : rangeParam === '7d' ? 7 : 1
  const to = dayOf(Date.now(), await ownerTimezone(db))
  const from = shiftDay(to, -(range - 1))
  const pfrom = shiftDay(from, -range), pto = shiftDay(from, -1)
  const dev = deviceId ? ' AND device_id = ?' : ''
  const args = (a: string, b: string) => (deviceId ? [a, b, deviceId] : [a, b])
  const q = (table: 'daily_rollup' | 'tool_daily', a: string, b: string) => table === 'daily_rollup'
    ? db.prepare(`SELECT 'claude' tool, device_id, model, sum(in_tok) in_tok, sum(out_tok) out_tok, sum(cache_write_tok) cache_write_tok,
        sum(cache_read_tok) cache_read_tok, sum(cache_write_1h_tok) cache_write_1h_tok FROM daily_rollup WHERE day BETWEEN ? AND ? AND model != ''${dev} GROUP BY device_id, model`).bind(...args(a, b))
    : db.prepare(`SELECT tool, device_id, model, sum(in_tok) in_tok, sum(out_tok) out_tok, sum(cache_write_tok) cache_write_tok,
        sum(cache_read_tok) cache_read_tok, 0 cache_write_1h_tok FROM tool_daily WHERE day BETWEEN ? AND ?${dev} GROUP BY tool, device_id, model`).bind(...args(a, b))
  const [c1, t1, c0, t0, devices] = await db.batch([
    q('daily_rollup', from, to), q('tool_daily', from, to), q('daily_rollup', pfrom, pto), q('tool_daily', pfrom, pto),
    db.prepare('SELECT id, name, last_seen, revoked_at FROM devices ORDER BY created_at'),
  ])
  type R = { tool: string; device_id: string; model: string; in_tok: number; out_tok: number; cache_write_tok: number; cache_read_tok: number; cache_write_1h_tok: number }
  const tokens = (r: R) => r.in_tok + r.out_tok + r.cache_write_tok + r.cache_read_tok
  const sumUp = (rows: R[]) => {
    const byTool = new Map<string, { tokens: number; cost: number }>(), byModel = new Map<string, { tokens: number; cost: number }>(), byDevice = new Map<string, number>()
    let total = 0, spend = 0
    const bump = (m: Map<string, { tokens: number; cost: number }>, k: string, t: number, c: number) => {
      const v = m.get(k) ?? { tokens: 0, cost: 0 }
      v.tokens += t
      v.cost += c
      m.set(k, v)
    }
    for (const r of rows) {
      const t = tokens(r), k = cost(r.model, r) ?? 0
      total += t
      spend += k
      bump(byTool, r.tool, t, k)
      bump(byModel, r.model, t, k)
      byDevice.set(r.device_id, (byDevice.get(r.device_id) ?? 0) + t)
    }
    return { total, spend, byTool, byModel, byDevice }
  }
  const cur = sumUp([...c1.results, ...t1.results] as R[])
  const prev = sumUp([...c0.results, ...t0.results] as R[])
  const labels: Record<string, string> = { claude: 'Claude Code', ...TOOLS }
  const all = devices.results as { id: string; name: string; last_seen: number | null; revoked_at: number | null }[]
  const list = (m: Map<string, { tokens: number; cost: number }>, label: (k: string) => string) =>
    [...m].map(([key, v]) => ({ key, label: label(key), ...v })).filter((x) => x.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const me = deviceId ? all.findIndex((d) => d.id === deviceId) : -1
  return {
    scope: deviceId ? 'device' : 'all',
    device: me >= 0 ? { id: all[me].id, name: all[me].name, chip: me } : null,
    range: { days: range, from, to },
    tokens: cur.total, cost: cur.spend, previous_tokens: prev.total,
    by_tool: list(cur.byTool, (k) => labels[k] ?? k),
    by_model: list(cur.byModel, (k) => k).slice(0, 6),
    // Other devices appear only in the owner's view.
    by_device: deviceId ? [] : all.map((d, chip) => ({ id: d.id, name: d.name, chip, tokens: cur.byDevice.get(d.id) ?? 0, last_seen: d.last_seen, revoked: !!d.revoked_at }))
      .filter((d) => !d.revoked).sort((a, b) => b.tokens - a.tokens),
  }
}

dashboard.get('/summary', async (c) => c.json(await summarize(c.env.DB, c.req.query('range'))))

// Devices at a glance (admin overview): each computer's tokens today / 7 / 30 days (Claude Code and
// other tools), active time this week, and when it was last active and last sent a prompt.
dashboard.get('/device-usage', async (c) => {
  const db = c.env.DB
  const today = dayOf(Date.now(), await ownerTimezone(db))
  const d7 = shiftDay(today, -6), d30 = shiftDay(today, -29)
  const tok = 'in_tok + out_tok + cache_write_tok + cache_read_tok'
  const sums = `sum(CASE WHEN day = ?1 THEN ${tok} ELSE 0 END) today, sum(CASE WHEN day >= ?2 THEN ${tok} ELSE 0 END) week, sum(${tok}) month`
  const [devices, claude, tools, active, lastSession, lastPrompt] = await db.batch([
    db.prepare('SELECT id, name, os, last_seen, revoked_at FROM devices ORDER BY created_at'),
    db.prepare(`SELECT device_id, ${sums} FROM daily_rollup WHERE day >= ?3 GROUP BY device_id`).bind(today, d7, d30),
    db.prepare(`SELECT device_id, ${sums} FROM tool_daily WHERE day >= ?3 GROUP BY device_id`).bind(today, d7, d30),
    db.prepare('SELECT device_id, sum(active_seconds) active FROM daily_rollup WHERE day >= ? GROUP BY device_id').bind(d7),
    db.prepare('SELECT device_id, max(ended_at) last FROM sessions GROUP BY device_id'),
    db.prepare('SELECT s.device_id, max(p.ts) last FROM prompts p JOIN sessions s ON s.id = p.session_id GROUP BY s.device_id'),
  ])
  type S = { device_id: string; today: number; week: number; month: number }
  const map = <T extends { device_id: string }>(r: D1Result) => new Map((r.results as T[]).map((x) => [x.device_id, x]))
  const cl = map<S>(claude), tl = map<S>(tools)
  const act = map<{ device_id: string; active: number }>(active)
  const ls = map<{ device_id: string; last: number }>(lastSession), lp = map<{ device_id: string; last: number }>(lastPrompt)
  return c.json((devices.results as { id: string; name: string; os: string | null; last_seen: number | null; revoked_at: number | null }[])
    .map((d, chip) => ({
      id: d.id, name: d.name, os: d.os, chip, revoked: !!d.revoked_at, last_seen: d.last_seen,
      today: (cl.get(d.id)?.today ?? 0) + (tl.get(d.id)?.today ?? 0),
      week: (cl.get(d.id)?.week ?? 0) + (tl.get(d.id)?.week ?? 0),
      month: (cl.get(d.id)?.month ?? 0) + (tl.get(d.id)?.month ?? 0),
      active_week: act.get(d.id)?.active ?? 0,
      last_active: ls.get(d.id)?.last ?? null,
      last_prompt: lp.get(d.id)?.last ?? null,
    }))
    .filter((d) => !d.revoked))
})

// People (admin): each account with tokens today / 7 / 30 days (owner's days), its computers and last activity.
dashboard.get('/people', async (c) => {
  const db = c.env.DB
  const today = dayOf(Date.now(), await ownerTimezone(db))
  const d7 = shiftDay(today, -6), d30 = shiftDay(today, -29)
  const [accounts, usage, devices, last] = await db.batch([
    db.prepare('SELECT uuid, email, display_name, plan, status FROM accounts'),
    db.prepare(`SELECT account_uuid,
        sum(CASE WHEN day = ?1 THEN in_tok + out_tok + cache_write_tok + cache_read_tok ELSE 0 END) today,
        sum(CASE WHEN day >= ?2 THEN in_tok + out_tok + cache_write_tok + cache_read_tok ELSE 0 END) week,
        sum(in_tok + out_tok + cache_write_tok + cache_read_tok) month
      FROM daily_rollup WHERE day >= ?3 GROUP BY account_uuid`).bind(today, d7, d30),
    db.prepare(`SELECT DISTINCT r.account_uuid, d.id, d.name FROM daily_rollup r JOIN devices d ON d.id = r.device_id WHERE r.day >= ? AND d.revoked_at IS NULL`).bind(d30),
    db.prepare('SELECT account_uuid, max(ended_at) last FROM sessions GROUP BY account_uuid'),
  ])
  type U = { account_uuid: string; today: number; week: number; month: number }
  const u = new Map((usage.results as U[]).map((r) => [r.account_uuid, r]))
  const l = new Map((last.results as { account_uuid: string; last: number }[]).map((r) => [r.account_uuid, r.last]))
  const order = { pending: 0, approved: 1, ignored: 2 } as Record<string, number>
  return c.json((accounts.results as { uuid: string; email: string | null; display_name: string | null; plan: string | null; status: string }[])
    .map((a) => ({
      ...a,
      today: u.get(a.uuid)?.today ?? 0, week: u.get(a.uuid)?.week ?? 0, month: u.get(a.uuid)?.month ?? 0,
      last_active: l.get(a.uuid) ?? null,
      devices: (devices.results as { account_uuid: string; id: string; name: string }[]).filter((d) => d.account_uuid === a.uuid).map((d) => ({ id: d.id, name: d.name })),
    }))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.month - a.month))
})

// FTS5 query from free text: each word quoted (no operators), prefix match on the last one.
const ftsQuery = (q: string) => {
  const words = q.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ')
}

// One prompt in full (the list sends the first 400 characters of each).
dashboard.get('/prompts/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT id, ts, text FROM prompts WHERE id = ?').bind(c.req.param('id')).first()
  return r ? c.json(r) : c.json({ error: 'not_found' }, 404)
})
dashboard.get('/prompts', async (c) => {
  const f = await filters(c)
  const q = ftsQuery(c.req.query('q') ?? '')
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER
  const cond = ['p.day BETWEEN ? AND ?', 'p.ts < ?']
  const args: (string | number)[] = [f.from, f.to, before]
  for (const [k, col] of [['device', 's.device_id'], ['account', 'p.account_uuid'], ['project', 's.project_key']] as const) {
    if (f[k]) {
      cond.push(`${col} = ?`)
      args.push(f[k]!)
    }
  }
  const sql = q
    ? `SELECT p.id, p.ts, p.session_id, s.title, s.device_id, s.project_key,
              snippet(prompts_fts, 0, char(2), char(3), '...', 24) text
       FROM prompts_fts JOIN prompts p ON p.rowid = prompts_fts.rowid JOIN sessions s ON s.id = p.session_id
       WHERE prompts_fts MATCH ? AND ${cond.join(' AND ')} ORDER BY p.ts DESC LIMIT 50`
    : `SELECT p.id, p.ts, p.session_id, s.title, s.device_id, s.project_key, substr(p.text, 1, 400) text
       FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE ${cond.join(' AND ')} ORDER BY p.ts DESC LIMIT 50`
  const r = await c.env.DB.prepare(sql).bind(...(q ? [q, ...args] : args)).all()
  return c.json(r.results)
})

// Tools found on devices, and whether each is turned on everywhere (global settings `tools`).
dashboard.get('/tools', async (c) => {
  const db = c.env.DB
  const [seen, global] = await db.batch([
    db.prepare('SELECT tool, device_id, first_seen, last_seen FROM tools_seen ORDER BY tool'),
    db.prepare(`SELECT json FROM settings WHERE scope = 'global' AND scope_id = ''`),
  ])
  const on = (JSON.parse((global.results[0] as { json: string } | undefined)?.json ?? '{}').tools ?? {}) as Record<string, boolean>
  return c.json(Object.entries(TOOLS).map(([tool, label]) => ({
    tool, label, enabled: !!on[tool],
    devices: (seen.results as { tool: string; device_id: string; last_seen: number }[]).filter((s) => s.tool === tool).map((s) => ({ id: s.device_id, last_seen: s.last_seen })),
  })))
})

// Free-plan headroom: estimated D1 writes today (Phase 0: ~3 per turn, ~4 per prompt) and database size.
dashboard.get('/usage', async (c) => {
  const db = c.env.DB
  const today = dayOf(Date.now(), await ownerTimezone(db))
  const r = await db.prepare('SELECT coalesce(sum(turns), 0) turns, coalesce(sum(prompts), 0) prompts, count(*) rows FROM daily_rollup WHERE day = ?').bind(today).first<{ turns: number; prompts: number; rows: number }>()
  return c.json({
    writes_today_estimate: r!.turns * 3 + r!.prompts * 4 + r!.rows * 2,
    writes_limit: 100_000,
    db_bytes: (await db.prepare('SELECT 1').run()).meta.size_after ?? null,
    db_limit_bytes: 500 * 1024 * 1024,
  })
})

// Data actions. Deleting rebuilds every rollup from the earliest affected day.
dashboard.post('/data/delete', async (c) => {
  const { scope, id, from, to } = await c.req.json<{ scope: 'device' | 'account' | 'project' | 'range'; id?: string; from?: string; to?: string }>()
  const db = c.env.DB
  const day = /^\d{4}-\d{2}-\d{2}$/
  let sessionFilter: string
  let args: string[]
  let turnFilter: string
  if (scope === 'range') {
    if (!from?.match(day) || !to?.match(day)) return c.json({ error: 'bad_range' }, 400)
    turnFilter = 'day BETWEEN ? AND ?'
    sessionFilter = 'day BETWEEN ? AND ?'
    args = [from, to]
  } else if (scope === 'device' || scope === 'project' || scope === 'account') {
    if (!id) return c.json({ error: 'id_required' }, 400)
    const col = { device: 'device_id', project: 'project_key', account: 'account_uuid' }[scope]
    sessionFilter = `${col} = ?`
    turnFilter = scope === 'account' ? 'account_uuid = ?' : `session_id IN (SELECT id FROM sessions WHERE ${col} = ?)`
    args = [id]
  } else return c.json({ error: 'bad_scope' }, 400)
  const first = await db.prepare(`SELECT min(day) d FROM (SELECT day FROM turns WHERE ${turnFilter} UNION ALL SELECT day FROM sessions WHERE ${sessionFilter})`)
    .bind(...args, ...args).first<string>('d')
  // Other tools' rows have no account or project, so only device and date-range deletes reach them.
  const toolDeletes = scope === 'device' ? [db.prepare('DELETE FROM tool_daily WHERE device_id = ?').bind(id!), db.prepare('DELETE FROM tools_seen WHERE device_id = ?').bind(id!)]
    : scope === 'range' ? [db.prepare('DELETE FROM tool_daily WHERE day BETWEEN ? AND ?').bind(from!, to!)] : []
  const toolChanges = toolDeletes.length ? (await db.batch(toolDeletes)).reduce((n, r) => n + (r.meta.changes ?? 0), 0) : 0
  if (!first) return c.json({ ok: true, deleted: toolChanges > 0 })
  await db.batch([
    db.prepare(`DELETE FROM turns WHERE ${turnFilter}`).bind(...args),
    db.prepare(`DELETE FROM prompts WHERE ${turnFilter}`).bind(...args),
    db.prepare(`DELETE FROM sessions WHERE ${sessionFilter} AND NOT EXISTS (SELECT 1 FROM turns WHERE session_id = sessions.id)`).bind(...args),
  ])
  await rebuildRollups(db, first)
  return c.json({ ok: true, deleted: true })
})

dashboard.get('/export', async (c) => {
  const db = c.env.DB
  const format = c.req.query('format') === 'csv' ? 'csv' : 'json'
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'csv') {
    const rows = (await db.prepare('SELECT * FROM daily_rollup ORDER BY day').all<Row>()).results
    const cols = ['day', 'device_id', 'account_uuid', 'project_key', 'model', 'effort', ...SUMS, 'cost_estimate_usd'] as const
    const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
    const lines = rows.map((r) => cols.map((k) => esc(k === 'cost_estimate_usd' ? (r.model ? (cost(r.model, r)?.toFixed(4) ?? '') : '') : r[k])).join(','))
    return c.body([cols.join(','), ...lines].join('\n'), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="devicetally-daily-${stamp}.csv"`,
    })
  }
  const [devices, accounts, projects, sessions, prompts, turns, settings, toolDaily] = await db.batch(
    ['devices', 'accounts', 'projects', 'sessions', 'prompts', 'turns', 'settings', 'tool_daily'].map((t) =>
      db.prepare(t === 'devices' ? 'SELECT id, name, os, arch, agent_version, created_at, last_seen, revoked_at FROM devices' : `SELECT * FROM ${t}`)),
  )
  return c.json(
    { exported_at: new Date().toISOString(), devices: devices.results, accounts: accounts.results, projects: projects.results, sessions: sessions.results, prompts: prompts.results, turns: turns.results, settings: settings.results, tool_daily: toolDaily.results },
    200,
    { 'content-disposition': `attachment; filename="devicetally-export-${stamp}.json"` },
  )
})
