# DeviceTally

Self-hosted, multi-device usage tracker for Claude Code and other AI coding tools, with a Tauri tray app. The full spec is in `docs/dev/PLAN.md`; read only the section you need.

## Layout (see docs/dev/PLAN.md §10)
- `agent/`: Go agent (single binary). Tests: `cd agent && go test ./...`
- `worker/`: Cloudflare Worker (Hono, TypeScript) + D1 `migrations/`. Tests: `cd worker && npm test`
- `app/`: Tauri menu-bar / tray app with the main window (Preact + TS, Rust). Tests: `cd app/src-tauri && cargo test`. Build: `cd app && npm run app`. The web dashboard was removed (2026-10-03); the Worker is API-only.
- `scripts/`: install.sh / install.ps1 (served by the Worker)
- `fixtures/`: scrubbed sample transcripts; `fixtures/project-key.json` is shared by Go and TS tests

## Rules
- Hooks must never block Claude Code: `async: true`, the hook only appends to the local queue and starts a detached `sync` (async hooks are killed when Claude exits), no network on the hook path.
- Filter + redact on the device, before upload, on every upload path (docs/dev/PLAN.md §2.2).
- Ingest is idempotent (upsert with MAX per token column, keyed by message.id); rollups apply only the change (docs/dev/PLAN.md §7).
- D1 migrations: forward-only and additive within a major version (docs/dev/PLAN.md §10a).
- No UI code before `docs/dev/DESIGN.md` is approved (docs/dev/PLAN.md §6.1).
- Least code that works: reuse, then stdlib, then platform. Tests are required; extra features are not.
- Parser bugs: add a fixture + failing test first.
- After adding or changing a server endpoint, deploy the Worker (`cd worker && npx wrangler deploy`) before testing clients against the live server.

## Working style (docs/dev/PLAN.md §10b)
- One milestone or sub-task per session, then `/clear`.
- Plans: Superpowers `writing-plans`, then `executing-plans` (inline). Subagents only for large independent tasks.
- Before finishing a milestone: run tests, then `/ponytail-review` on the diff.
