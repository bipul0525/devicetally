const TOK = 'in_tok, out_tok, cache_write_tok, cache_read_tok, cache_write_1h_tok, thinking_tok'

/** Rebuilds daily_rollup for every day >= `fromDay` from the raw tables (nightly safety net, timezone change). */
export function rebuildRollups(db: D1Database, fromDay: string) {
  return db.batch([
    db.prepare('DELETE FROM daily_rollup WHERE day >= ?').bind(fromDay),
    db.prepare('DELETE FROM hourly_activity WHERE day >= ?').bind(fromDay),
    db.prepare(
      `INSERT INTO hourly_activity (day, hour, device_id, account_uuid, project_key, turns)
       SELECT t.day, t.hour, s.device_id, t.account_uuid, s.project_key, count(*)
       FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.day >= ? AND t.hour IS NOT NULL GROUP BY 1, 2, 3, 4, 5`,
    ).bind(fromDay),
    db.prepare(
      `INSERT INTO hourly_activity (day, hour, device_id, account_uuid, project_key, prompts)
       SELECT p.day, p.hour, s.device_id, p.account_uuid, s.project_key, count(*)
       FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE p.day >= ? AND p.hour IS NOT NULL GROUP BY 1, 2, 3, 4, 5
       ON CONFLICT DO UPDATE SET prompts = excluded.prompts`,
    ).bind(fromDay),
    db.prepare(
      `INSERT INTO daily_rollup (day, device_id, account_uuid, project_key, model, effort, ${TOK}, turns)
       SELECT t.day, s.device_id, t.account_uuid, s.project_key, coalesce(t.model, ''), coalesce(t.effort, ''),
              sum(t.in_tok), sum(t.out_tok), sum(t.cache_write_tok), sum(t.cache_read_tok), sum(t.cache_write_1h_tok), sum(coalesce(t.thinking_tok, 0)), count(*)
       FROM turns t JOIN sessions s ON s.id = t.session_id WHERE t.day >= ? GROUP BY 1, 2, 3, 4, 5, 6`,
    ).bind(fromDay),
    db.prepare(
      `INSERT INTO daily_rollup (day, device_id, account_uuid, project_key, model, effort, prompts)
       SELECT p.day, s.device_id, p.account_uuid, s.project_key, '', '', count(*)
       FROM prompts p JOIN sessions s ON s.id = p.session_id WHERE p.day >= ? GROUP BY 1, 2, 3, 4
       ON CONFLICT DO UPDATE SET prompts = excluded.prompts`,
    ).bind(fromDay),
    db.prepare(
      `INSERT INTO daily_rollup (day, device_id, account_uuid, project_key, model, effort, sessions, active_seconds)
       SELECT day, device_id, account_uuid, project_key, '', '', count(*), sum(active_seconds)
       FROM sessions WHERE day >= ? GROUP BY 1, 2, 3, 4
       ON CONFLICT DO UPDATE SET sessions = excluded.sessions, active_seconds = excluded.active_seconds`,
    ).bind(fromDay),
  ])
}
