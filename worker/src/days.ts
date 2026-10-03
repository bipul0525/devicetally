const fmts = new Map<string, Intl.DateTimeFormat>()

/** Local calendar day (YYYY-MM-DD) of an epoch-ms timestamp in the owner's timezone. */
export function dayOf(ts: number, timeZone: string) {
  let f = fmts.get(timeZone)
  if (!f) fmts.set(timeZone, (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })))
  return f.format(new Date(ts))
}

const hourFmts = new Map<string, Intl.DateTimeFormat>()

/** Local hour (0-23) of an epoch-ms timestamp in the owner's timezone. */
export function hourOf(ts: number, timeZone: string) {
  let f = hourFmts.get(timeZone)
  if (!f) hourFmts.set(timeZone, (f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })))
  return Number(f.format(new Date(ts)))
}

export async function ownerTimezone(db: D1Database) {
  return (await db.prepare('SELECT timezone FROM owner WHERE id = 1').first<string>('timezone')) ?? 'UTC'
}
