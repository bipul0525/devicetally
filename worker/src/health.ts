// Device health: what each computer reports every 5 minutes (tracking gaps, lock state, disk, whether
// the app runs), and a disk-full estimate from one reading a day.
import type { Context } from 'hono'
import type { Env } from './auth'
import { dayOf, ownerTimezone } from './days'

const MAX = 16_000 // bytes of health JSON kept per device

export async function reportHealth(c: Context<Env>) {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'bad_request' }, 400)
  const now = Date.now()
  // Two reporters: the app (every 5 minutes while it runs) and the tracker's background job (every 5
  // minutes even when the app is closed). Each report is merged in, stamped with its sender's time,
  // so the admin sees "online" from either and whether the app itself is running.
  const from = body.from === 'tracker' ? 'tracker' : 'app'
  delete body.from
  body[from === 'tracker' ? 'tracker_at' : 'app_at'] = now
  const json = JSON.stringify(body)
  if (json.length > MAX) return c.json({ error: 'too_large' }, 413)
  const db = c.env.DB
  const id = c.get('deviceId')
  const free = Number(body.disk_free), total = Number(body.disk_total)
  const stmts = [db.prepare("UPDATE devices SET health = json_patch(coalesce(health, '{}'), ?), health_at = ?, last_seen = ? WHERE id = ?").bind(json, now, now, id)]
  if (free > 0 && total > 0) {
    // One reading a day (the latest wins): enough for a trend, and only one write per check-in.
    stmts.push(db.prepare('INSERT INTO disk_samples (device_id, day, free, total) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET free = excluded.free, total = excluded.total')
      .bind(id, dayOf(now, await ownerTimezone(db)), Math.round(free), Math.round(total)))
  }
  await db.batch(stmts)
  return c.json({ ok: true })
}

/** Days until the disk is full at the trend of the last 30 daily readings (least squares), or null. */
export function fullInDays(samples: { day: string; free: number }[]): number | null {
  if (samples.length < 3) return null
  const xs = samples.map((s) => Date.parse(s.day + 'T00:00:00Z') / 86400_000)
  const ys = samples.map((s) => s.free)
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (!den) return null
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den // bytes per day
  if (slope >= 0) return null // not filling up
  const last = ys[n - 1]
  return Math.max(0, Math.round(last / -slope))
}

export async function diskTrends(db: D1Database): Promise<Map<string, number | null>> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const rows = (await db.prepare('SELECT device_id, day, free FROM disk_samples WHERE day >= ? ORDER BY day').bind(since).all()).results as { device_id: string; day: string; free: number }[]
  const by = new Map<string, { day: string; free: number }[]>()
  for (const r of rows) by.set(r.device_id, [...(by.get(r.device_id) ?? []), r])
  return new Map([...by].map(([id, s]) => [id, fullInDays(s)]))
}
