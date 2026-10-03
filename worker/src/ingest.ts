import type { Context } from 'hono'
import type { Env } from './auth'
import { dayOf, hourOf, ownerTimezone } from './days'

export type AccountIn = { uuid: string; email?: string; display_name?: string; org_name?: string; plan?: string }
export type SessionIn = {
  id: string; account_uuid: string; project_key: string; project_name?: string
  cwd?: string; git_branch?: string; title?: string; entrypoint?: string; cc_version?: string
  started_at: number; ended_at: number
}
export type PromptIn = { id: string; session_id: string; account_uuid: string; ts: number; text?: string | null }
export type TurnIn = {
  id: string; session_id: string; account_uuid: string; ts: number; model?: string; effort?: string
  in_tok: number; out_tok: number; cache_write_tok: number; cache_read_tok: number; cache_write_1h_tok?: number
  thinking_tok?: number | null; is_subagent?: boolean
}
export type Batch = { accounts?: AccountIn[]; sessions?: SessionIn[]; prompts?: PromptIn[]; turns?: TurnIn[] }

export const MAX_ITEMS = 500
export const ACTIVE_GAP_MS = 5 * 60_000
const TOK = ['in_tok', 'out_tok', 'cache_write_tok', 'cache_read_tok', 'cache_write_1h_tok', 'thinking_tok'] as const

type Delta = Record<(typeof TOK)[number] | 'turns' | 'prompts' | 'sessions' | 'active_seconds', number>
type SessionInfo = { account_uuid: string; project_key: string; day: string; active_seconds: number }

/** Sums changes per rollup key so each request writes one row per key. */
class Rollup {
  rows = new Map<string, Delta & { key: string[] }>()
  hours = new Map<string, { key: (string | number)[]; turns: number; prompts: number }>()
  addHour(key: (string | number)[], d: { turns?: number; prompts?: number }) {
    const k = JSON.stringify(key)
    let r = this.hours.get(k)
    if (!r) this.hours.set(k, (r = { key, turns: 0, prompts: 0 }))
    r.turns += d.turns ?? 0
    r.prompts += d.prompts ?? 0
  }
  add(key: string[], d: Partial<Delta>) {
    const k = JSON.stringify(key)
    let r = this.rows.get(k)
    if (!r) this.rows.set(k, (r = { key, in_tok: 0, out_tok: 0, cache_write_tok: 0, cache_read_tok: 0, cache_write_1h_tok: 0, thinking_tok: 0, turns: 0, prompts: 0, sessions: 0, active_seconds: 0 }))
    for (const [f, v] of Object.entries(d)) (r as any)[f] += v
  }
  statement(db: D1Database) {
    const out: D1PreparedStatement[] = []
    if (this.hours.size) {
      const json = [...this.hours.values()].map(({ key: [day, hour, device_id, account_uuid, project_key], turns, prompts }) => ({ day, hour, device_id, account_uuid, project_key, turns, prompts }))
      out.push(db.prepare(
        `INSERT INTO hourly_activity (day, hour, device_id, account_uuid, project_key, turns, prompts)
         SELECT j.value->>'day', j.value->>'hour', j.value->>'device_id', j.value->>'account_uuid', j.value->>'project_key', j.value->>'turns', j.value->>'prompts'
         FROM json_each(?) j WHERE true
         ON CONFLICT DO UPDATE SET turns = turns + excluded.turns, prompts = prompts + excluded.prompts`,
      ).bind(JSON.stringify(json)))
    }
    const rows = [...this.rows.values()].filter((r) => Object.entries(r).some(([f, v]) => f !== 'key' && v !== 0))
    if (!rows.length) return out
    const json = rows.map(({ key: [day, device_id, account_uuid, project_key, model, effort], ...d }) => ({ day, device_id, account_uuid, project_key, model, effort, ...d }))
    const cols = [...TOK, 'turns', 'prompts', 'sessions', 'active_seconds']
    return [
      ...out,
      db.prepare(
        `INSERT INTO daily_rollup (day, device_id, account_uuid, project_key, model, effort, ${cols.join(', ')})
         SELECT j.value->>'day', j.value->>'device_id', j.value->>'account_uuid', j.value->>'project_key', j.value->>'model', j.value->>'effort',
                ${cols.map((c) => `j.value->>'${c}'`).join(', ')}
         FROM json_each(?) j WHERE true
         ON CONFLICT DO UPDATE SET ${cols.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`,
      ).bind(JSON.stringify(json)),
    ]
  }
}

const inList = (field = 'value') => `(SELECT ${field} FROM json_each(?))`

export async function ingest(c: Context<Env>) {
  const db = c.env.DB
  const deviceId = c.get('deviceId')
  const b = await c.req.json<Batch>()
  if ([b.accounts, b.sessions, b.prompts, b.turns].some((a) => (a?.length ?? 0) > MAX_ITEMS)) return c.json({ error: 'batch_too_large', max: MAX_ITEMS }, 413)
  const now = Date.now()

  // 1. Record every account seen (new ones stay 'pending' until approved in the dashboard).
  if (b.accounts?.length) {
    await db.prepare(
      `INSERT INTO accounts (uuid, email, display_name, org_name, plan, first_seen_device, first_seen_at)
       SELECT j.value->>'uuid', j.value->>'email', j.value->>'display_name', j.value->>'org_name', j.value->>'plan', ?2, ?3 FROM json_each(?1) j WHERE true
       ON CONFLICT (uuid) DO UPDATE SET email = coalesce(excluded.email, email), display_name = coalesce(excluded.display_name, display_name),
         org_name = coalesce(excluded.org_name, org_name), plan = coalesce(excluded.plan, plan)`,
    ).bind(JSON.stringify(b.accounts), deviceId, now).run()
  }

  // 2. Second line of defence: the agent already drops unapproved accounts.
  const approved = new Set((await db.prepare(`SELECT uuid FROM accounts WHERE status = 'approved'`).all<{ uuid: string }>()).results.map((r) => r.uuid))
  const ok = <T extends { account_uuid: string }>(a: T[] = []) => a.filter((x) => approved.has(x.account_uuid))
  const sessionsIn = ok(b.sessions), promptsIn = ok(b.prompts), turnsIn = ok(b.turns)
  const tz = await ownerTimezone(db)

  // 3. Sessions: existing ones (must belong to this device) + new ones from the batch.
  const sessionIds = [...new Set([...sessionsIn.map((s) => s.id), ...promptsIn.map((p) => p.session_id), ...turnsIn.map((t) => t.session_id)])]
  const existing = new Map<string, SessionInfo & { device_id: string }>()
  for (const r of (await db.prepare(`SELECT id, device_id, account_uuid, project_key, day, active_seconds FROM sessions WHERE id IN ${inList()}`)
    .bind(JSON.stringify(sessionIds)).all<SessionInfo & { id: string; device_id: string }>()).results) existing.set(r.id, r)

  const sessions = new Map<string, SessionInfo>()
  const rollup = new Rollup()
  const sessionRows: (SessionIn & { day: string })[] = []
  for (const s of sessionsIn) {
    const e = existing.get(s.id)
    if (e && e.device_id !== deviceId) continue
    const day = e?.day ?? dayOf(s.started_at, tz)
    sessionRows.push({ ...s, day })
    if (!e) rollup.add([day, deviceId, s.account_uuid, s.project_key, '', ''], { sessions: 1 })
  }
  for (const [id, e] of existing) if (e.device_id === deviceId) sessions.set(id, e)
  for (const s of sessionRows) if (!sessions.has(s.id)) sessions.set(s.id, { account_uuid: s.account_uuid, project_key: s.project_key, day: s.day, active_seconds: 0 })

  // 4. Turns: a reply can arrive again with higher counts (Phase 0). Store the max; roll up only the increase.
  const turns = turnsIn.filter((t) => sessions.has(t.session_id))
  type Old = { id: string; day: string; model: string | null; effort: string | null; account_uuid: string } & Record<(typeof TOK)[number], number | null>
  const old = new Map<string, Old>()
  if (turns.length) {
    for (const r of (await db.prepare(`SELECT id, day, model, effort, account_uuid, ${TOK.join(', ')} FROM turns WHERE id IN ${inList()}`)
      .bind(JSON.stringify(turns.map((t) => t.id))).all<Old>()).results) old.set(r.id, r)
  }
  const changedTurns: (TurnIn & { day: string; hour: number | null })[] = []
  for (const t of turns) {
    const o = old.get(t.id)
    const s = sessions.get(t.session_id)!
    const d: Partial<Delta> = {}
    let changed = !o
    for (const f of TOK) {
      const inc = Math.max(0, (t[f] ?? 0) - (o?.[f] ?? 0))
      d[f] = inc
      if (inc > 0 || (f === 'thinking_tok' && o && o.thinking_tok == null && t.thinking_tok != null)) changed = true
    }
    if (!changed) continue
    const day = o?.day ?? dayOf(t.ts, tz)
    if (!o) {
      d.turns = 1
      rollup.addHour([day, hourOf(t.ts, tz), deviceId, t.account_uuid, s.project_key], { turns: 1 })
    }
    rollup.add([day, deviceId, o?.account_uuid ?? t.account_uuid, s.project_key, o?.model ?? t.model ?? '', o?.effort ?? t.effort ?? ''], d)
    changedTurns.push({ ...t, day, hour: o ? null : hourOf(t.ts, tz) })
  }

  // 5. Prompts: insert-only (text never changes).
  const prompts = promptsIn.filter((p) => sessions.has(p.session_id))
  const seen = new Set<string>()
  if (prompts.length) {
    for (const r of (await db.prepare(`SELECT id FROM prompts WHERE id IN ${inList()}`).bind(JSON.stringify(prompts.map((p) => p.id))).all<{ id: string }>()).results) seen.add(r.id)
  }
  const newPrompts = prompts.filter((p) => !seen.has(p.id) && !!seen.add(p.id)).map((p) => ({ ...p, day: dayOf(p.ts, tz), hour: hourOf(p.ts, tz) }))
  for (const p of newPrompts) {
    const s = sessions.get(p.session_id)!
    rollup.add([p.day, deviceId, p.account_uuid, s.project_key, '', ''], { prompts: 1 })
    rollup.addHour([p.day, p.hour, deviceId, p.account_uuid, s.project_key], { prompts: 1 })
  }

  // 6. Write everything in one atomic batch.
  const stmts: D1PreparedStatement[] = []
  if (sessionRows.length) {
    const projects = [...new Map(sessionRows.map((s) => [s.project_key, s.project_name ?? s.project_key])).entries()]
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO projects (key, display_name) SELECT j.value->>0, j.value->>1 FROM json_each(?) j`).bind(JSON.stringify(projects)),
      db.prepare(
        `INSERT INTO sessions (id, device_id, account_uuid, project_key, cwd, git_branch, title, entrypoint, cc_version, started_at, ended_at, day)
         SELECT j.value->>'id', ?2, j.value->>'account_uuid', j.value->>'project_key', j.value->>'cwd', j.value->>'git_branch', j.value->>'title',
                j.value->>'entrypoint', j.value->>'cc_version', j.value->>'started_at', j.value->>'ended_at', j.value->>'day'
         FROM json_each(?1) j WHERE true
         ON CONFLICT (id) DO UPDATE SET started_at = min(started_at, excluded.started_at), ended_at = max(ended_at, excluded.ended_at),
           title = coalesce(excluded.title, title), git_branch = coalesce(excluded.git_branch, git_branch), cc_version = coalesce(excluded.cc_version, cc_version)
         WHERE sessions.device_id = excluded.device_id`,
      ).bind(JSON.stringify(sessionRows), deviceId),
    )
  }
  if (changedTurns.length) {
    stmts.push(db.prepare(
      `INSERT INTO turns (id, session_id, account_uuid, ts, day, hour, model, effort, ${TOK.join(', ')}, is_subagent)
       SELECT j.value->>'id', j.value->>'session_id', j.value->>'account_uuid', j.value->>'ts', j.value->>'day', j.value->>'hour', j.value->>'model', j.value->>'effort',
              coalesce(j.value->>'in_tok', 0), coalesce(j.value->>'out_tok', 0), coalesce(j.value->>'cache_write_tok', 0), coalesce(j.value->>'cache_read_tok', 0),
              coalesce(j.value->>'cache_write_1h_tok', 0), j.value->>'thinking_tok', coalesce(j.value->>'is_subagent', 0)
       FROM json_each(?) j WHERE true
       ON CONFLICT (id) DO UPDATE SET in_tok = max(in_tok, excluded.in_tok), out_tok = max(out_tok, excluded.out_tok),
         cache_write_tok = max(cache_write_tok, excluded.cache_write_tok), cache_read_tok = max(cache_read_tok, excluded.cache_read_tok),
         cache_write_1h_tok = max(cache_write_1h_tok, excluded.cache_write_1h_tok),
         thinking_tok = CASE WHEN excluded.thinking_tok IS NULL THEN thinking_tok WHEN thinking_tok IS NULL THEN excluded.thinking_tok
                             ELSE max(thinking_tok, excluded.thinking_tok) END`,
    ).bind(JSON.stringify(changedTurns)))
  }
  if (newPrompts.length) {
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO prompts (id, session_id, account_uuid, ts, day, hour, text)
       SELECT j.value->>'id', j.value->>'session_id', j.value->>'account_uuid', j.value->>'ts', j.value->>'day', j.value->>'hour', j.value->>'text' FROM json_each(?) j`,
    ).bind(JSON.stringify(newPrompts)))
  }
  stmts.push(...rollup.statement(db))
  if (stmts.length) await db.batch(stmts)

  // 7. Active time: recompute whole sessions that got new events (correct across split or late batches).
  const touched = [...new Set([...changedTurns.filter((t) => !old.has(t.id)).map((t) => t.session_id), ...newPrompts.map((p) => p.session_id)])]
  if (touched.length) {
    const fresh = (await db.prepare(
      `WITH ev AS (SELECT session_id s, ts FROM turns WHERE session_id IN ${inList()} UNION ALL SELECT session_id, ts FROM prompts WHERE session_id IN ${inList()}),
            g AS (SELECT s, ts - lag(ts) OVER (PARTITION BY s ORDER BY ts) gap FROM ev)
       SELECT s id, coalesce(sum(CASE WHEN gap < ? THEN gap END), 0) / 1000 active FROM g GROUP BY s`,
    ).bind(JSON.stringify(touched), JSON.stringify(touched), ACTIVE_GAP_MS).all<{ id: string; active: number }>()).results
    const active = new Rollup()
    const updates: { id: string; active: number }[] = []
    for (const r of fresh) {
      const s = sessions.get(r.id)!
      if (r.active === s.active_seconds) continue
      updates.push(r)
      active.add([s.day, deviceId, s.account_uuid, s.project_key, '', ''], { active_seconds: r.active - s.active_seconds })
    }
    if (updates.length) {
      await db.batch([
        db.prepare(`UPDATE sessions SET active_seconds = j.value->>'active' FROM json_each(?) j WHERE sessions.id = j.value->>'id'`).bind(JSON.stringify(updates)),
        ...active.statement(db),
      ])
    }
  }

  return c.json({
    accepted: { sessions: sessionRows.length, turns: changedTurns.length, prompts: newPrompts.length },
    dropped: {
      unapproved: (b.sessions?.length ?? 0) - sessionsIn.length + (b.prompts?.length ?? 0) - promptsIn.length + (b.turns?.length ?? 0) - turnsIn.length,
      unknown_session: turnsIn.length - turns.length + promptsIn.length - prompts.length,
    },
  })
}
