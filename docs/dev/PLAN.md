# DeviceTally: Plan

> Name: **DeviceTally** (neutral, no "Claude" trademark issue). Description: "Multi-device usage dashboard for Claude Code". Binary and folders: `devicetally`.

**Goal.** One free, self-hosted dashboard that shows how *you* use Claude Code on every machine you work on: which device, which Claude account, which project, every prompt, tokens, model, effort, and time spent.

**Who it's for.** You first. Then anyone with the same problem, released as an open-source repo they can deploy to their own Cloudflare account in a few clicks.

**Design rules**
1. **Never slow Claude Code down.** Every hook runs in the background (`async`). Nothing waits on the network.
2. **Easy.** Deploy with one button. Add a device with one pasted command. After that, nothing to do.
3. **Private by default.** Each person self-hosts their own instance. Filtering happens on the device, so data you turn off never leaves the machine.
4. **Free.** Fits within Cloudflare's free tier for one heavy user.

---

## 1. What exists today and why build this

From research done on 2026-10-02:

| Project | Gap for this use case |
|---|---|
| ccusage (~18.8k stars) | Single machine, terminal only, no prompts |
| claude-code-karma (~330) | Great session viewer, single machine |
| ColeMurray/claude-code-otel (~500) | Multi-device, but a heavy Grafana/Prometheus/Loki stack, no history import, clunky prompt view |
| jimdawdy-hub/claude-usage-tracker (~3) | Multi-device, but no effort, weak prompts, tiny project |
| RyanTech00/claude-telemetry | Tied to hosted Supabase, no prompts or effort |

**What none of them do together:** per-device and per-account views, full prompt history, model and effort breakdown, active time, settings controlled from the dashboard, history import, free one-click hosting.

---

## 2. Architecture

```
 Each device (macOS / Linux / Windows)          Your Cloudflare account (free)
┌──────────────────────────────────────┐     ┌───────────────────────────────┐
│ Claude Code (VS Code ext or CLI)     │     │ Worker                        │
│   │ hooks (async, never block)       │     │  /api/ingest   (device key)   │
│   ▼                                  │     │  /api/config   (device key)   │
│ devicetally agent (single binary)    │     │  /api/*        (dashboard)    │
│  • captures prompt + account         │────►│  /install, /enroll            │
│  • reads new transcript lines        │HTTPS│ Static assets: dashboard SPA  │
│  • applies your settings (filters)   │     │ D1 (SQLite): data + rollups   │
│  • queues offline, sends in batches  │     │ Cron: retention cleanup       │
└──────────────────────────────────────┘     └───────────────────────────────┘
                                                        ▲
                                          you, from any browser (login)
```

Office and home don't need to be on the same network. Devices only make outgoing HTTPS requests to your `*.workers.dev` URL, so no port forwarding or firewall changes are needed.

### 2.1 Where the data comes from

| Data | Source | Stability |
|---|---|---|
| Prompt text, session id, cwd | `UserPromptSubmit` hook input | Documented hook API |
| Effort | Transcript: `effort` / `perTurnEffort` on each reply (confirmed in Phase 0) | Undocumented |
| Which Claude account | `~/.claude.json` → `oauthAccount`, read when the prompt is submitted | Undocumented but simple |
| Tokens (input, output, cache write/read), model per reply. Thinking tokens from `usage.output_tokens_details.thinking_tokens` when present (confirmed in Phase 0; included in output tokens) | Transcript JSONL at `transcript_path` | **Undocumented, can change between Claude Code versions** |
| Session title, git branch, extension vs CLI, version | Transcript JSONL | Undocumented |
| Subagent usage | Separate files: `<sessionId>/subagents/agent-<id>.jsonl` + `.meta.json` (confirmed in Phase 0; about half of all usage) | Undocumented |
| History from before install | Existing transcripts (Claude Code deletes them after 30 days by default) | Undocumented |

**Handling format changes:**
- The parser reads only the few fields it needs and ignores everything else.
- It logs a "format drift" warning, shown in the dashboard, when an expected field disappears.
- It is covered by fixture tests built from real transcripts.
- A weekly CI job runs the newest Claude Code and checks the parser still works.
- Fallback: Claude Code's official OpenTelemetry export also reports tokens, model, effort and account. It can become a second input later (see Roadmap) if the transcript format ever breaks badly.

### 2.2 Hooks (zero slowdown)

The installer adds these hooks to the user-level `~/.claude/settings.json`. It merges with existing settings and backs up the file first. All three are `"async": true`, so Claude never waits for them. **But `async` alone is not enough** (Phase 0): Claude Code kills unfinished async hooks when it exits, so the hook only appends to the local queue (~1 ms) and starts `devicetally sync` as a **detached process** that outlives Claude. See `spikes/phase0-hooks-and-cloudflare.md`. The installer checks the Claude Code version and refuses (with a clear message) on versions without async hook support, instead of silently installing blocking hooks.

| Hook | Agent does | Cost to Claude |
|---|---|---|
| `SessionStart` | Download settings, catch up on anything unsent | None (async) |
| `UserPromptSubmit` | Append prompt, `prompt_id`, cwd, session and account to a local queue file | None (async) |
| `Stop` (each finished reply) | Start one detached background `sync` (see below) | None (async, detached) |

**`sync` behaviour:**
- A lock file ensures only one sync runs at a time. If a sync is already running, it marks "dirty" and exits.
- It reads only the bytes added since the last sync. Each transcript's read position is saved.
- It filters by your settings, sends one batched HTTPS request (10 s timeout) and exits.
- **One shared filter pipeline** runs on every path that uploads data (live hooks, sync, history import): account allowlist → excluded folders → project/device settings → secret redaction. Redaction covers prompt text *and* session titles (titles are generated from prompts).
- **Project key is computed on the device** (normalised git remote URL, else folder name) with the same function the Worker uses, so project-level settings and excluded folders can be applied before upload. The function and its test vectors live in `fixtures/project-key.json` and are tested in both Go and TypeScript.
- On failure, the data stays queued and goes out on the next sync. Nothing is lost when offline.
- It is read-only on Claude's files and never modifies transcripts.
- The transcript can lag slightly behind the hook. Any missed lines are picked up by the next sync.

There's no daemon or background service, and no extra Node.js or Python to install.

### 2.3 Agent

- **Go**, compiled to one static binary per platform: macOS (arm64, amd64), Linux (amd64, arm64), Windows (amd64, arm64).
- Built and published to GitHub Releases by GitHub Actions and goreleaser.
- Installs to `~/.devicetally/` (macOS/Linux) or `%LOCALAPPDATA%\devicetally\` (Windows).
- Commands: `login`, `sync`, `status`, `pause` / `resume`, `uninstall` (removes the hooks and restores settings), `update`.
- Self-updates in the background (see section 10a, Updates).
- Supports several Claude config folders (`CLAUDE_CONFIG_DIR`) on one machine.

---

## 3. Onboarding

### 3.1 Host it (once, about 3 minutes)

> **Superseded (2026-10-03):** the Deploy button was replaced by `npm run setup` (see README and PLAN-desktop.md §5).

1. Click **Deploy to Cloudflare** in the README. Cloudflare forks the repo and creates the Worker and the D1 database. The `deploy` script runs the database migrations.
2. Open `https://devicetally.<you>.workers.dev`. A first-run screen asks you to create the owner login (**email + password**).
   - A stranger must not be able to claim a fresh instance first. The deploy flow asks for a `SETUP_TOKEN` secret (the Deploy button prompts for secrets); the first-run screen requires it. Manual deploys set it with `wrangler secret put SETUP_TOKEN`. Once the owner exists, setup is permanently closed.
3. **Login is your own email and password.** After signing in, you stay signed in on that browser for 30 days (sliding: renewed whenever you use it), so you rarely type it. "Sign out everywhere" is in Settings.
4. Optional extra lock: **Cloudflare Access** (free, up to 50 users) in front of the dashboard. Not required; useful if you want the page to be unreachable for anyone but you. Device API routes (`/api/ingest`, `/api/config`, `/i/*`) are excluded from Access so agents keep working.

Manual alternative: `git clone` → `npm i` → `npx wrangler login` → `npm run deploy`.

### 3.2 Add a device (once per device, about 1 minute)

In the dashboard, go to **Devices → Add device**, type a name ("Office PC"), and copy the one-line command it shows:

```
macOS / Linux:  curl -fsSL https://devicetally.you.workers.dev/i/K7XR4M | sh
Windows:        irm https://devicetally.you.workers.dev/i/K7XR4M | iex
```

The code `K7XR4M` is single-use and expires after 15 minutes. The script:
1. Downloads the right binary.
2. Exchanges the code for a permanent **device key**, stored on the device only.
3. Adds the hooks.
4. Shows which Claude account is signed in ("Track bipul@work.com? [Y/n]").
5. Imports the existing history in the background.

For a device without a browser handy, run `devicetally login`. It asks for your dashboard URL, email and password, then you approve the device in the dashboard.

### 3.3 Daily use

Nothing. Use Claude Code as usual.

When Claude logs you out and you sign in again (Anthropic's link and code), DeviceTally is unaffected. Its device key is separate from Claude's login and lasts until you revoke it.

---

## 4. Accounts and shared office devices

In the office, the same machine may be used by you and by colleagues with their own Claude accounts. The rule: **only accounts you approve are tracked.**

- Every captured event is labelled with the Claude account that was signed in at that moment: the account UUID, plus email and plan for display.
- The agent downloads your account allowlist. Events from accounts that aren't approved are **dropped on the device**. They're never uploaded.
- The dashboard shows "An unapproved account was seen on Office PC" with the email, so you can approve it if it's one of yours. What happens to new accounts is configurable:
  - **Ignore** (default): drop the data, show only the notice.
  - **Ask**: hold the data on the device for up to 7 days pending your decision.
  - **Track automatically**: only for setups where every account is yours.
- **Before the allowlist has been downloaded** (first install, offline), nothing is uploaded: events wait in the local queue until the allowlist is known. During install the account you confirm ("Track …? [Y/n]") is approved immediately.
- **Account switch mid-session:** every prompt and every turn carries the account read at that moment (turns inherit the account of the prompt that started them). A session can therefore span accounts; the session row stores the account of its first prompt, and per-account totals use turn-level data.
- Different operating-system users on one machine each have their own `~/.claude`. The agent only sees the OS user it was installed for.
- If you ever track other people (a team setup), they should know, and prompt storage can be turned off for their accounts.

---

## 5. Settings (all toggles live in the dashboard)

Settings are layered, and the most specific level wins: **Global → Account → Device → Project.**

The agent downloads the settings at each `SessionStart` and before each upload, and applies them **before** anything leaves the device. Changes take effect within seconds.

| Toggle | Default |
|---|---|
| Tracking on/off (pause everything) | On |
| Token usage | On |
| Model and effort | On |
| Cost estimate | On |
| Prompt text | On |
| Redact secrets in prompts (API keys, tokens, passwords, `.env`-style lines) | On |
| Session titles | On |
| Full folder paths (off = project name only) | On |
| Git repo and branch | On |
| Tool usage counts | Off |
| Subagent usage | On |
| Excluded folders (glob list, e.g. `~/personal/*`) | Empty |
| New account policy | Ignore |
| Keep prompts for | 90 days |
| Keep usage stats for | Forever |

Data actions:
- Delete everything for an account, device, project or date range.
- Export to CSV or JSON.
- Revoke a device.

---

## 6. Dashboard

Every page has filters for time range, device, account, project, model and effort, and they are kept in the URL so views can be bookmarked.

1. **Overview: "Totals"**
   - Tokens (split by type), estimated cost, active time, sessions, prompts.
   - Breakdowns by device, account, project, model and effort.
   - A day-by-hour activity chart showing when you work.
2. **Devices.** Each device: OS, last seen, accounts used, top projects, tokens, active time. Rename and revoke.
3. **Accounts.** Each Claude account: plan, devices it's used on, usage. Approve or ignore.
4. **Projects.** Tokens and time per project, split by device, model and effort. The same repo on different machines is merged using its git remote URL.
5. **Sessions.** A list with title, device, project, start time, duration and tokens. Opening one shows a timeline of each prompt with the tokens, model, effort and time for that turn.
6. **Prompts.** Full-text search across all prompts (D1 supports SQLite FTS5).
7. **Settings.** Everything from section 5.
8. **Add device.** The one-line installer described in 3.2.

**Definitions**
- **Active time:** the sum of gaps between consecutive events in a session, counting only gaps under 5 minutes. Idle time is excluded. It is **recomputed per affected session** on ingest (not added per batch), so late or split batches are correct. Changing the threshold triggers a background recompute.
- **Day:** days are cut in your time zone (set at first-run setup from the browser, changeable in Settings), not UTC. A change applies to data from then on; re-cutting all history would cost one D1 write per stored row.
- **Session time:** from first event to last.
- **Cost:** an "API-equivalent estimate" from a price table in the repo. On a Pro or Max plan you pay a flat fee, and the dashboard says so instead of implying you were charged.

### 6.1 UI approach (anti-slop)

Use [anti-slop](https://github.com/miqdadbadjuber/anti-slop) (MIT) as the UI rulebook during the build:

1. Install it as a Claude Code skill for this repo.
2. **Write `DESIGN.md` first, and have you approve it before any UI code.** It is required by anti-slop R-37 and covers palette (2 to 3 colors plus 1 accent), typeface, mood, the ENERGY / RHYTHM / MOTION dials, and one repeating visual motif.
   - Proposed direction, to be confirmed: quiet and data-first, tabular numbers, one accent color for "active", no decoration.
3. Rules that matter most for a dashboard:
   - Real data only (R-17, R-38).
   - Designed empty, loading and error states (R-27). Day one with no data must look intentional.
   - WCAG AA contrast (R-25).
   - Full keyboard navigation (R-32).
   - Light and dark mode both working (R-34).
   - Mobile with no overflow and 44px tap targets (R-03).
   - Every button does something real (R-26).
4. Every UI milestone ends with anti-slop's **Delivery Gate** report (PASS/FAIL).

**Frontend stack.** Vite, Preact (small) and TypeScript. Charts are plain SVG or uPlot, both lightweight. The SPA is served as Workers Static Assets, which are free and unlimited and don't count toward the Worker request quota.

---

## 7. Data model (D1)

```
owner         id, email, password_hash, pbkdf2_iterations, timezone, created_at
auth_sessions id_hash, created_at, expires_at, user_agent
meta          key, value   (schema_version, app_version)
devices       id, name, os, arch, agent_version, key_hash, created_at, last_seen, revoked_at
enroll_codes  code_hash, device_name, expires_at, used_at
accounts      uuid, email, display_name, org_name, plan, status(approved|ignored|pending)
projects      id, key (git remote or folder name), display_name
sessions      id, device_id, account_uuid, project_id, cwd, git_branch, title,
              entrypoint, cc_version, started_at, ended_at, active_seconds
turns         id (message id), session_id, account_uuid, ts, model, effort,
              in_tok, out_tok, cache_write_tok, cache_read_tok, thinking_tok (nullable), is_subagent
prompts       id, session_id, ts, text   (+ FTS5 index)
daily_rollup  day, device_id, account_uuid, project_id, model, effort,
              tokens..., cost_est, active_seconds, prompts, sessions
settings      scope(global|account|device|project), scope_id, json
```

- Ingest is **idempotent**, keyed by `message.id` (turns) and `promptId` (prompts), so re-sending is always safe.
- **One reply appears on several transcript lines**, and earlier lines can hold partial token counts (see `spikes/phase0-transcripts.md`). So:
  - The agent collapses lines by `message.id` within each read, keeping the largest `output_tokens`. A reply still being written is simply sent again with higher counts next sync; the server keeps the max, so no hold-back is needed.
  - The server upserts turns with `MAX()` per token column (never `INSERT OR IGNORE`), only when a count actually grew, and applies only the difference to rollups.
- Each batch is inserted as a single statement over a JSON array (`json_each`). This stays within D1's 100-parameter and 50-queries-per-request limits.
- **Rollups never double count.** Rollups are updated only by the *change* each request makes (new rows, or the increase from a later, more complete line of the same reply). Re-sending a batch changes nothing. Re-sending a batch changes nothing. A nightly cron also rebuilds the last 2 days of rollups from `turns` as a safety net.
- Dashboard charts read **only `daily_rollup`**. This keeps page loads fast and well under 5M rows read per day.

---

## 8. Free tier budget (verified 2026-10-02)

| Limit (free) | Expected use for one heavy user, 3 to 5 devices |
|---|---|
| Workers: 100k requests/day | About 1 sync per reply → a few thousand/day |
| Workers: 10 ms CPU/request | Small batches (≤ 200 rows), no heavy crypto in the hot path |
| D1: 100k rows written/day | About 2 to 3k replies/day. Each index update and the FTS5 index count as extra rows written, so measured in Phase 0: 3 per turn, 4 per prompt → about **11 to 12k**. Upserts skip unchanged rows (`WHERE excluded.out_tok > out_tok`) so re-sends cost nothing |
| D1: 5M rows read/day | Dashboard uses rollups → well under |
| D1: 500 MB/DB | Prompts are small text. Years of use, and retention caps growth |
| Static assets | Free, unlimited |
| Access: 50 users | 1 |
| Cron: 5/account | 1 (nightly retention cleanup) |

The dashboard shows a small usage meter so you notice early if you approach a limit.

---

## 8a. Backups

- D1 Time Travel restores the database to any minute in the last 7 days (free plan), so a bad migration or accidental delete can be undone. `docs/` explains the one `wrangler d1 time-travel restore` command.
- Settings → Export lets you download a full JSON backup at any time.
- Before applying migrations, the update workflow records a Time Travel bookmark, so you can roll back to the exact pre-update state.

---

## 9. Security

- Device keys are random 32-byte tokens, stored hashed on the server. Revoking one is instant.
- Owner password hashed with WebCrypto PBKDF2-SHA256 at **100,000 iterations** (the Workers cap; confirmed to run on the free plan in Phase 0). The count is stored per hash so it can be raised later. Hashing only happens at login (a few times a month), not per request.
- Dashboard sessions: random token in an `HttpOnly; Secure; SameSite=Strict` cookie, stored hashed in `auth_sessions`, 30-day sliding expiry. Checking it is one cheap lookup, no crypto in the hot path.
- Login is rate-limited (lockout with backoff after repeated failures).
- Enrollment codes are single-use, expire after 15 minutes and are rate-limited.
- Secret redaction runs on the device before upload, on every upload path (live, sync, import).
- The install script verifies the binary's SHA-256 checksum (served by the Worker from the release manifest) before running it, from the first release on.
- HTTPS only. No third-party analytics, no data leaves your Cloudflare account.

---

## 10. Repository layout

```
devicetally/
  agent/            Go agent (cmd/, internal/parser, internal/hooks, internal/sync)
  worker/           Cloudflare Worker (Hono, TypeScript), migrations/
  web/              Dashboard SPA (Vite + Preact + TS)
  scripts/          install.sh, install.ps1 (served by the Worker)
  fixtures/         Sample transcripts for parser tests (scrubbed)
  docs/             Setup, privacy, FAQ
  DESIGN.md         UI direction (approved before UI work)
  wrangler.jsonc    Deploy-button ready
  LICENSE           MIT
```

---

## 10a. Updates

Two things get updated: **your Worker** (server + dashboard + database) and **the agent on each device**.

### Worker (your Cloudflare deployment)

The Deploy button makes a fork in your GitHub account and connects it to Workers Builds, which redeploys on every push to `main`. The fork doesn't follow the upstream repo on its own, so:

1. The repo ships a GitHub Actions workflow `.github/workflows/sync-upstream.yml` in your fork. It runs daily (and on demand) and fast-forwards your `main` to the latest **release tag** upstream (not raw `main`).
2. That push triggers Workers Builds → the `deploy` script runs **D1 migrations first**, then deploys the Worker and dashboard.
3. Auto-update is a choice in Settings → Updates: **Automatic** (default) or **Notify only** (the dashboard shows "v1.4 available: changelog · Update now"; "Update now" triggers the same workflow).
4. Manual deploys: `git pull && npm run deploy`.

Migration rules:
- Forward-only, numbered SQL files in `worker/migrations/`, applied by `wrangler d1 migrations apply`.
- **Additive only** within a major version (new tables/columns, never drop or rename), so an older Worker or agent keeps working during rollout.
- Large backfills (e.g. rollup rebuilds) run in small chunks from the cron, not in the migration.
- The dashboard shows the schema version and a warning if migrations are pending.

### Agent (each device)

- The Worker publishes `/api/config` fields: `agent_latest`, `agent_min_supported`, and the download URL + SHA-256 for each platform.
- At `SessionStart` the agent compares versions. If newer, it downloads in the background, **verifies the checksum** (and the signature once releases are signed), swaps the binary atomically (on Windows: rename the old one aside, since a running exe can't be overwritten) and keeps the previous one for `devicetally update --rollback`.
- Auto-update can be turned off per device in Settings; then the dashboard just shows "Office PC is on v1.2, latest is v1.4".
- Hook definitions are versioned too: after an update, the agent re-merges its hooks in `settings.json` if the hook spec changed.

### Compatibility contract

- API is versioned (`/api/v1/...`). Each agent request sends `X-DeviceTally-Agent: <version>`.
- A Worker supports the current and previous minor agent versions. Older agents get a `426` with an "update required" message that `status` shows; their queued data stays on the device until they update. Nothing is lost.
- Releases follow semver. The changelog marks breaking changes, and a major version bump ships a migration guide.

---

## 10b. How we build it (keeping AI token cost low)

The project is built with Claude Code, so the way it's built affects token cost as much as what gets built.

**Plugins** (review each repo's skill files before installing, and pin the installed version):
- [Superpowers](https://github.com/obra/superpowers): used for its *process*: `brainstorming` → `writing-plans` → `test-driven-development` → `systematic-debugging`. Its token savings come from planning once and avoiding rework, not from shorter answers.
  - Use **`executing-plans`** (inline, the cheapest mode) by default. Use `subagent-driven-development` only for large, independent tasks: each subagent starts fresh and re-reads context, which costs more tokens.
  - Skip brainstorming for tasks this plan already specifies.
- [Ponytail](https://github.com/dietrichgebert/ponytail): enforces "least code that works": reuse, then standard library, then platform features, and only then new code. Use intensity **`full`**, plus `/ponytail-review` on each milestone's diff. Less code means fewer tokens to write, read back and review later.
- anti-slop: UI rules only (section 6.1).
- **Reviewed on 2026-10-03** (Superpowers commit `8ca22db`, Ponytail commit `6c97ffa`):
  - Neither plugin makes network calls or reads secrets. Their hooks only read their own files and print instructions.
  - Superpowers adds ~0.8k tokens per session (its intro skill, loaded at session start).
  - Ponytail adds ~1.3k tokens per session and again per subagent (its rules, loaded at session start). It writes a small mode file under `~/.claude` and `~/.config/ponytail`. It needs Node.js.
  - Ponytail also hooks `UserPromptSubmit` (to switch modes). It doesn't touch DeviceTally's hooks.
  - Pin these commits. Re-review the hook scripts before moving to a newer version.
- If two plugins conflict (for example, Superpowers asking for more tests while Ponytail asks for less code), **this plan and `CLAUDE.md` win**: tests are required, extra features are not.

**Habits that save the most tokens:**
1. A short **`CLAUDE.md`** (under 100 lines) with the repo layout, commands (`npm test`, `go test ./...`, `npm run deploy`) and pointers to `PLAN.md` / `DESIGN.md`, so each session doesn't rediscover the repo.
2. **One milestone (or sub-task) per session**, then `/clear`. Long sessions re-send the whole history on every turn.
3. Give exact file paths and fixtures in prompts. Don't ask for "explore the codebase".
4. Small, cheap dependencies only: Hono, Preact, uPlot, Go standard library. Nothing that needs large generated code.
5. Fixtures over live debugging: parser bugs are reproduced as a fixture file + failing test, not by pasting long transcripts into chat.
6. Use a cheaper model (Sonnet / Haiku) for mechanical work (migrations, boilerplate, docs). Keep the strongest model for design, parser and sync logic.

**Dogfooding:** install DeviceTally's own agent as soon as Milestone 2 works. From then on, the project measures its own build cost per milestone, and the habits above can be checked against real numbers.

---

## 11. Milestones

**Status (2026-10-03):** Milestones -1 to 5 done and verified (see `spikes/`, `delivery-gate-m5.md`). Milestone 7 is built locally: releases (GoReleaser, cosign-signed checksums), one-line installers at `/i/<code>`, checksum-verified `update` / `--rollback`, the upstream-sync workflow, README, privacy doc, MIT license. Left: publish the repo, tag the first release, test the Deploy button on a fresh account, then Milestone 6 (a week on your real devices). Not built: the "Ask" new-account policy; "Track automatically" also needs server support.

| # | Milestone | Done when |
|---|---|---|
| -1 | **Repo setup** | `CLAUDE.md`, Superpowers + Ponytail installed and pinned, CI skeleton |
| 0 | **Spikes** | Async hooks confirmed on macOS, Windows and Linux with no measurable delay (and minimum Claude Code version noted); parser reads your real transcripts, incl. subagent files; confirm where effort and thinking tokens come from; PBKDF2 CPU tested; D1 writes per turn measured with real indexes + FTS5; deploy button provisions D1 and prompts for `SETUP_TOKEN` |
| 1 | **Worker + D1** | Schema, ingest, config, enroll, email/password login; idempotent ingest tested **including that re-sent batches don't change rollups**; active-time recompute and time-zone day boundaries tested |
| 2 | **Agent** | `enroll`, hooks install/uninstall, detached incremental sync, offline queue (transcript offsets), account allowlist, shared filter pipeline + redaction; unit tests on all 3 OSes in CI; end-to-end import matched an independent recount exactly. **Moved to Milestone 7** (need published releases): `update` with checksum check, `/i/<code>` install script, `login` with email/password. **Not yet:** "Ask" new-account policy (holding data for 7 days) |
| 3 | **History import** | Existing transcripts upload correctly; totals match ccusage on the same machine (cross-check) |
| 4 | **DESIGN.md** | You approve the UI direction |
| 5 | **Dashboard v1** | Overview, Devices, Accounts, Projects, Sessions, Prompts, Settings, Add device; anti-slop Delivery Gate PASS |
| 6 | **Your rollout** | Running on your real devices (office and home) for a week |
| 7 | **Open-source release** | README with screenshots, deploy button, upstream-sync workflow tested on a fresh fork, docs, CI, signed releases |

## 12. Roadmap (after v1)

- A Claude Code **plugin** install path (`/plugin install`) as an alternative to the one-line installer.
- **OpenTelemetry input** as a backup data source.
- "Live now" view showing which device is running a session right now.
- Weekly email or summary.
- Team mode: several people, each seeing only their own data, with an admin overview.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Transcript format changes in a Claude Code update | Tolerant parser, drift warning, weekly CI against latest Claude Code, OTel fallback on the roadmap |
| Claude Code deletes transcripts after 30 days | Sync after every reply; offer to raise `cleanupPeriodDays` during install (you choose) |
| Re-sent or late data skews totals | Rollups only from newly inserted rows; per-session active-time recompute; nightly rebuild |
| An update breaks a self-hosted instance | Release tags only, additive migrations, N-1 agent compatibility, "Notify only" mode, agent rollback |
| Editing `~/.claude/settings.json` | Merge, never overwrite; back up first; `uninstall` restores |
| Free-tier limits | Rollups, batching, usage meter |
| Capturing other people's prompts on shared machines | Only approved accounts are uploaded; unknown accounts are dropped on the device |

---

## 14. Decisions

1. **Name:** DeviceTally.
2. **Login:** your own email + password, 30-day sliding session. Cloudflare Access is optional, not required.
3. **Prompt retention default:** 90 days (configurable, including forever).
4. **Raise Claude's 30-day transcript cleanup:** offered during install, default no, with a note that older history will be lost.
5. **Updates:** Worker auto-updates from release tags by default (switchable to notify-only); agents self-update in the background.
