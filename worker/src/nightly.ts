import { dayOf, ownerTimezone } from './days'
import { rebuildRollups } from './rollup'

const DAY_MS = 24 * 3600_000

// Retention, cleanup and the rollup safety net. Kept out of index.ts: a Worker's main module may only export handlers.
export async function nightly(db: D1Database, now = Date.now()) {
  const global = JSON.parse((await db.prepare(`SELECT json FROM settings WHERE scope = 'global' AND scope_id = ''`).first<string>('json')) ?? '{}')
  const keepPromptDays: number | null = global.keep_prompts_days === undefined ? 90 : global.keep_prompts_days // null = forever
  const stmts = [
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM enroll_codes WHERE expires_at < ?').bind(now - DAY_MS),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - DAY_MS),
  ]
  if (keepPromptDays) stmts.push(db.prepare('DELETE FROM prompts WHERE ts < ?').bind(now - keepPromptDays * DAY_MS))
  await db.batch(stmts)
  await rebuildRollups(db, dayOf(now - 2 * DAY_MS, await ownerTimezone(db)))
}
