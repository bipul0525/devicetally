import type { Context } from 'hono'
import type { Env } from './auth'

// Tools DeviceTally can read through tokscale. Claude Code has its own, more detailed reader.
export const TOOLS: Record<string, string> = { codex: 'Codex', opencode: 'OpenCode', kimi: 'Kimi' }

type Row = { tool: string; model: string; provider?: string; in_tok: number; out_tok: number; cache_read_tok: number; cache_write_tok: number; reasoning_tok: number; messages: number }
type Upload = { seen?: string[]; tools?: string[]; days?: { day: string; rows: Row[] }[] }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 400

/** POST /api/v1/tools: tools found on the device, and snapshots of enabled tools per day. */
export async function toolsIngest(c: Context<Env>) {
  const db = c.env.DB
  const deviceId = c.get('deviceId')
  const b = await c.req.json<Upload>()
  const now = Date.now()
  const stmts: D1PreparedStatement[] = []

  const seen = (b.seen ?? []).filter((t) => t in TOOLS)
  if (seen.length) {
    stmts.push(db.prepare(
      `INSERT INTO tools_seen (device_id, tool, first_seen, last_seen) SELECT ?1, value, ?2, ?2 FROM json_each(?3) WHERE true
       ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen`,
    ).bind(deviceId, now, JSON.stringify(seen)))
  }

  // Only tools the owner enabled are stored, even if a device sends more.
  const enabled = await enabledTools(db, deviceId)
  const tools = (b.tools ?? []).filter((t) => enabled.has(t))
  if ((b.days?.length ?? 0) > MAX_DAYS) return c.json({ error: 'too_many_days', max: MAX_DAYS }, 413)
  const days = (b.days ?? []).filter((d) => DAY.test(d.day))
  if (tools.length && days.length) {
    const rows = days.flatMap((d) => d.rows.filter((r) => tools.includes(r.tool) && r.model).map((r) => ({ ...r, day: d.day })))
    stmts.push(
      db.prepare(`DELETE FROM tool_daily WHERE device_id = ? AND day IN (SELECT value FROM json_each(?)) AND tool IN (SELECT value FROM json_each(?))`)
        .bind(deviceId, JSON.stringify(days.map((d) => d.day)), JSON.stringify(tools)),
    )
    if (rows.length) {
      stmts.push(db.prepare(
        `INSERT INTO tool_daily (device_id, day, tool, model, provider, in_tok, out_tok, cache_read_tok, cache_write_tok, reasoning_tok, messages)
         SELECT ?1, j.value->>'day', j.value->>'tool', j.value->>'model', j.value->>'provider',
                coalesce(j.value->>'in_tok', 0), coalesce(j.value->>'out_tok', 0), coalesce(j.value->>'cache_read_tok', 0),
                coalesce(j.value->>'cache_write_tok', 0), coalesce(j.value->>'reasoning_tok', 0), coalesce(j.value->>'messages', 0)
         FROM json_each(?2) j WHERE true
         ON CONFLICT DO UPDATE SET in_tok = excluded.in_tok, out_tok = excluded.out_tok, cache_read_tok = excluded.cache_read_tok,
           cache_write_tok = excluded.cache_write_tok, reasoning_tok = excluded.reasoning_tok, messages = excluded.messages, provider = excluded.provider`,
      ).bind(deviceId, JSON.stringify(rows)))
    }
  }
  if (stmts.length) await db.batch(stmts)
  return c.json({ ok: true, stored_tools: tools, days: days.length })
}

/** Tools turned on for this device: global `tools` setting, overridden by the device's own. */
export async function enabledTools(db: D1Database, deviceId: string) {
  const rows = (await db.prepare(`SELECT scope, json FROM settings WHERE (scope = 'global' AND scope_id = '') OR (scope = 'device' AND scope_id = ?)`)
    .bind(deviceId).all<{ scope: string; json: string }>()).results
  const merged: Record<string, boolean> = {}
  for (const scope of ['global', 'device']) {
    for (const r of rows) if (r.scope === scope) Object.assign(merged, JSON.parse(r.json).tools ?? {})
  }
  return new Set(Object.entries(merged).filter(([t, on]) => on && t in TOOLS).map(([t]) => t))
}
