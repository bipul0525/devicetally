# Phase 0: hooks and Cloudflare (2026-10-03)

Claude Code 2.1.283, macOS arm64, Go 1.27.1. Throwaway Worker + D1 `devicetally-spike` (deleted afterwards).

## Hooks

Test: `claude -p` with `UserPromptSubmit` + `Stop` hooks that take 5 s. Baseline run without hooks: ~7.4 s.

| Hook setup | Run time | Hook work finished? |
|---|---|---|
| `async: false`, slow work in the hook | ~17.4 s | yes (Claude waited ~10 s) |
| `async: true`, slow work in the hook | ~8.2 s | **no: 0 of 2 finished.** Claude kills unfinished async hooks when it exits |
| Hook appends to local queue, starts a detached `sync` (new session), returns | ~7.2 s | **yes, 2 of 2 queued and synced after Claude exited** |

Findings:
- `async: true` alone is **not enough**: work still running when Claude Code exits is lost (the last reply of a session, or every `-p` run).
- Correct pattern: the hook does only a local append (Go binary start + write: ~1 ms here), then starts `devicetally sync` as a **detached process** (`Setsid` on Unix; `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` on Windows), and exits.
- Don't pipe stdin to the detached child: the parent exits before the copy finishes and the child gets empty input. Write to the queue file first.
- Keep `async: true` as well, as a second guard.

Hook input fields (2.1.283):
- `UserPromptSubmit`: `session_id`, `prompt_id`, `prompt`, `cwd`, `transcript_path`, `permission_mode`.
- `Stop`: `session_id`, `prompt_id`, `cwd`, `transcript_path`, `last_assistant_message`, `stop_hook_active`, `background_tasks`.
- No effort field: effort comes from the transcript (see `phase0-transcripts.md`). `prompt_id` matches the transcript's `promptId`, so hook and transcript data join cleanly.

Still to do: run the same test on Linux and Windows (add it to CI in Milestone 2).

## PBKDF2 (WebCrypto, SHA-256)

| Iterations | Result (15 requests each) |
|---|---|
| 10,000 | 15 ok |
| 50,000 | 15 ok |
| 100,000 | 15 ok |
| 100,001 | error 1101: the platform cap is exactly 100,000 |

Decision: **100,000 iterations**. Login works on the free plan; no need for Cloudflare Access.

## D1 rows written (schema with secondary indexes + FTS5 trigger)

| Statement (one `json_each` batch) | Rows written per item |
|---|---|
| Turn upsert (row + 1 index) | 3 |
| Prompt insert (row + 1 index + FTS5) | 4 |
| Rollup upsert | 1 to 2 per rollup key, per batch (not per item) |
| Re-sending the same turns | **1 per turn**, even when nothing changes |

Findings:
- Budget for a heavy day (3,000 replies incl. subagents, 500 prompts): 3,000 × 3 + 500 × 4 + a few hundred rollup writes ≈ **11 to 12k rows/day**, far under 100k.
- A no-op upsert still counts as a write. Add `WHERE excluded.out_tok > turns.out_tok` to the upsert so re-sent, unchanged turns cost 0 writes.
- A batch of 100 turns + 100 prompts + 1 rollup is a single request and well within limits.

Not tested here: the Deploy button flow (needs the public repo; do it at Milestone 7).
