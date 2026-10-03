# DeviceTally v2: Desktop app, every AI coding tool, faster setup

Status: **agreed** (2026-10-03): **Tauri**, repo goes public, no Apple Developer account for now (first launch on a Mac needs right-click → Open), order 8 → 9 → 10 → 11 → 12.

## Goals

1. **A tray / menu-bar app** on macOS, Windows and Linux that shows **token counts only**: per tool, model and device, across all your machines. One click, no browser, no prompts on screen.
2. **Every AI coding tool**, not just Claude Code: Codex, Kimi, OpenCode, Gemini CLI / Antigravity, Copilot, Cursor and more, each switchable on and off.
3. **Install in seconds**, with no terminal noise: download the app, paste your server address and a code, done.
4. **Self-hosting by terminal commands and a clear README**, not a one-click button.
5. The web dashboard becomes an **installable web app** (desktop and phone).

What stays: the Cloudflare server (Worker + D1), the privacy model (filters on the device, only approved accounts), and Claude Code's full detail (prompts, sessions, effort) for those who want it on the web dashboard.

---

## 1. What we learned

### tokscale (the parser behind token-monitor)

| Fact | Why it matters |
|---|---|
| MIT, Rust, v4.17, single maintainer, very active | Usable, but it moves fast |
| **56 tools** in one registry (`crates/tokscale-core/src/clients.rs`), one parser file per tool | Covers everything we want, and each parser is a clean reference |
| Parses per message (`UnifiedMessage`: tool, model, session, project, time, tokens, dedup key) | The right granularity internally |
| **The CLI only outputs aggregates** (`--json --group-by client,model`, `graph` per day, `hourly`). No per-message export | Fine for "token counts only" |
| Incremental cache (file size + mtime + offsets, under `~/.config/tokscale`) | Rescans are cheap |
| Dedups Claude's repeated lines by `message.id:requestId` with per-field max, and handles 1-hour cache writes | Same conclusions we reached in Phase 0 |
| **Prices fetched at runtime** (LiteLLM, models.dev, OpenRouter); tokens need no network | We keep pricing on our server, from tokens |
| No telemetry; uploading to tokscale.ai is opt-in (`submit`, `autosubmit`) and needs a login | Safe to bundle; we never call those commands |
| Cursor, Antigravity IDE, Trae, Warp need an account cookie or API, not local files | Treat them as a separate, later step |
| Ships prebuilt binaries for 9 platforms via npm (`@tokscale/cli-<platform>`) | Easy to bundle in a desktop app |
| JSON output is unversioned; fields get added often | **Pin the version**; read fields tolerantly |

### token-monitor (the Electron app you used)

- **Collection:** runs the tokscale CLI (`--json --client … --group-by client,workspace,session,model`). File watcher → targeted "today" rescan → live within 3 to 5 s. Full scans run one after another to limit CPU.
- **Sync:** each device uploads a **complete pre-aggregated snapshot** (today, month, all-time; per tool, model, project) that **replaces** its previous one. Totals are added up when read. A Durable Object stores it and pushes changes to open apps over SSE.
- **Tray:** a normal window positioned next to the tray icon (cursor picks the display, clamped to the screen). macOS hides the Dock icon (`LSUIElement`).
- **Distribution:** signed and notarized macOS DMG, Windows installer signed free through SignPath (open-source programme), Linux AppImage, Homebrew cask, electron-updater from GitHub Releases.
- **Size:** ~130k lines of JavaScript, plus ~133k lines of tests. A 6,900-line main file, and lots of extras (floating bubble, edge dock, Windows z-order hacks, cookie-based quota scraping).
- **Choices to avoid:** credentials in a plaintext file, the secret in the URL, the monolith main file, the long tail of extras.

---

## 2. Decisions to make (with my recommendation)

### D1. Electron or Tauri?

| | Electron | Tauri |
|---|---|---|
| App size | ~100 to 150 MB | ~10 to 20 MB |
| Memory when idle | ~150 to 250 MB | ~40 to 80 MB |
| Language for the app shell | JavaScript/TypeScript | Rust (UI still web: our Preact code) |
| Use tokscale | Run its CLI as a bundled binary | **Link `tokscale-core` directly as a Rust library** (per-message data, no extra process) |
| Tray on Linux | Works, with quirks | Works, with quirks |
| Maturity, examples | Very high (token-monitor itself) | High |
| Auto-update, signing | electron-builder + electron-updater | Built-in updater + signing |

**Recommendation: Tauri.** For an app that sits in the menu bar all day, a 15 MB download and low idle memory matter, and Tauri can use tokscale's Rust core directly. If you prefer Electron (familiar tooling, token-monitor as a template), the plan below works the same; only the shell changes.

### D2. How to read the other tools

- **(a) Bundle the tokscale CLI** (pinned) and read its JSON. Fastest to ship, 50+ tools on day one.
- **(b) Use tokscale-core as a library** (only with Tauri). Per-message data and no extra process. Pinned git dependency; the API is not promised to stay stable.
- **(c) Port parsers to Go** for the few tools you use. Most control, most work, and we maintain them.

**Recommendation:** (b) with Tauri, or (a) with Electron. In both cases **Claude Code keeps our own reader**, which has prompts, effort and accounts, and tokscale is told to skip Claude so nothing is counted twice.

### D3. One collector or two?

Today the **Go agent** is the collector (Claude hooks, offline queue, filters). Options:

- **Keep the agent; the app shows totals and manages the agent** (installs it, enrolls it, shows its status). The agent keeps working without the app (servers, headless machines).
- Rewrite collection inside the app.

**Recommendation: keep the Go agent as the one collector, and bundle it inside the app.** It's tested, matched ccusage to the token, and already has hooks, the offline queue and the privacy filters. The app gains a small "other tools" collector (tokscale) whose results the agent uploads.

### D4. Make the repo public?

Required for **fast installs** (GitHub's CDN for downloads) and for **free Windows code signing** (SignPath only signs open-source projects). See "Making the repo public" below. **Recommendation: yes**, after the three clean-ups listed there.

### D5. Signing (costs money on macOS)

- **macOS:** without an Apple Developer account ($99/year), macOS shows "app can't be opened" and users must right-click → Open. With it, the app is signed and notarized and opens normally.
- **Windows:** SignPath is free for open-source; otherwise SmartScreen warns on first run.
- **Linux:** no signing needed.

**Recommendation:** start unsigned for your own machines, then decide before sharing it with others.

---

## 3. Architecture (recommended path)

```
 Each machine                                           Your Cloudflare account
┌────────────────────────────────────────────┐        ┌──────────────────────────────┐
│ DeviceTally app (tray / menu bar)          │        │ Worker (API + web app)        │
│   ├─ shows: today / week / month tokens    │◄──────►│   /api/v1/*  (device key)     │
│   │         by tool, model, device, cost   │  HTTPS │   /api/*     (your login)     │
│   ├─ sign-in, add this device, settings    │        │ D1: Claude detail + tool      │
│   └─ manages the bundled agent ──┐         │        │     totals per device/day     │
│                                  ▼         │        │ (later) Durable Object: live  │
│ devicetally agent (Go, existing)           │        │     push to open apps         │
│   ├─ Claude Code: hooks + transcripts      │        └──────────────────────────────┘
│   ├─ other tools: tokscale (pinned)        │
│   ├─ filters + redaction on device         │
│   └─ offline queue, uploads                │
└────────────────────────────────────────────┘
```

### New data path for other tools (token counts only)

- The agent asks tokscale for **per-day totals per tool and model** for days that changed (e.g. `graph`/`--group-by client,model` with a date range), excluding Claude Code.
- It uploads them as **snapshots that replace** that device's rows for those days: `tool_daily(device, day, tool, model, input, output, cache_read, cache_write, reasoning, messages)`. Re-sending is harmless, the same idea as token-monitor.
- The **server prices** them from tokens (our LiteLLM table, now extended beyond Claude models). No network needed on the device.
- Tool on/off switches live in the dashboard and the app. **A newly found tool is off until you enable it.** Off means tokscale is never asked about it.
- Accounts: most of these tools' logs don't say which account was used. Tool totals are therefore per device and tool, not per account. Claude keeps per-account tracking.

### Tray / menu-bar app

- **Popover (one click on the icon):**
  - Today's tokens as the focal number, plus cost and a "vs yesterday" change.
  - Tabs: **Today / 7 days / 30 days**.
  - By tool, by model, by device (device chips), each as a short bar list.
  - Last-updated time and sync status of this machine.
  - Buttons: Open dashboard, Pause tracking, Settings.
- **Menu-bar text (optional):** e.g. `1.7M` or `$4.20` next to the icon, chosen in settings.
- **Settings window:** server address, sign in, add this device, tools on/off, launch at login, theme, menu-bar text.
- **First run:** "Paste your server address" → "Sign in" (your email and password) → "Add this Mac" is one click (the app creates the code and enrolls itself; no terminal).
- **Reading data:** the app signs in with your owner login. The session is kept in the OS keychain (Electron `safeStorage` / Tauri keyring), never a plaintext file. A new compact endpoint `/api/summary?range=today|7d|30d` returns only totals per tool, model and device (no prompts, small, cacheable).
- **Freshness:** poll `/api/summary` every 30 s while the popover is open and every 5 min while closed (~1,500 requests/day per machine, well inside the free plan). Later: a Durable Object pushes updates over SSE for a live feel.
- **Out of scope for v1:** floating bubble, edge dock, native macOS widgets, quota scraping with cookies.

### Web dashboard → installable web app

- Add a web app manifest, icons and a small service worker (offline shell and last data).
- "Install" from Chrome/Edge/Safari puts it in the Dock/Start menu and on phones' home screens.
- New pages and filters: **Tool** filter everywhere, "By tool" panel, a tools section in Settings.

---

## 4. Faster installs and quiet output

**Why it was slow:** the private repo forced downloads through `gh` and the GitHub API (~2 minutes for 9 MB here). Public releases come from GitHub's CDN: typically a few seconds.

- **Public repo** → `curl -fsSL https://<server>/i/<code> | sh` downloads straight from the CDN.
- **Desktop app** → users download one installer; the agent is inside it, so there is nothing else to fetch.
- **Optional:** the Worker can also serve the agent binaries itself (Workers static assets), so installs never depend on GitHub.
- **Output** (done 2026-10-03): installing prints only the account question and `✓ <device> is connected.` after the history import finishes.

---

## 5. Self-hosting without the Deploy button

Replace the button with a short README section and one script:

```sh
git clone https://github.com/bipul0525/devicetally && cd devicetally/worker
npm ci
npx wrangler login
npm run setup        # creates the D1 database, applies migrations, generates and sets
                     # SETUP_TOKEN, deploys, then prints:
                     #   ✓ Your server: https://devicetally.<you>.workers.dev
                     #   ✓ Setup token: …  (use it once to create your login)
```

- `npm run update` later: pull the latest release tag, migrate, deploy.
- The upstream-sync workflow for forks stays optional and is documented, not automatic.

---

## 6. Making the repo public: what is and isn't exposed

- **Not in the repo or its history** (scanned 2026-10-03): setup token, passwords, device keys, database ID, your Claude account or its email, your server address. Key-like strings are fake test values.
- **Exposed:** the code, your commit name and email, and aggregate usage numbers in `spikes/`.
- **Your data stays private:** it lives only in your D1 database, and every data endpoint needs your login. Knowing the code doesn't give access; your server's address is already public by nature.
- **Before going public:**
  1. Rate-limit the device-code endpoint.
  2. Remove the usage numbers from `spikes/`.
  3. Optionally switch your commits to GitHub's private noreply email.

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| 8 ✓ | **Pre-public clean-up** | Code-endpoint rate limit, docs scrubbed, repo public, v0.2 released, `curl … \| sh` installs in seconds |
| 9 ✓ | **Self-host script** | `npm run setup` / `npm run update` work on a fresh Cloudflare account; README rewritten; Deploy button removed |
| 10 ✓ | **Tool spike** | On your Mac: tokscale (pinned) reads Codex, Kimi, OpenCode, Gemini/Antigravity; its totals checked against each tool's own numbers where possible (ccusage for Codex/OpenCode) |
| 11 ✓ | **Tools in the agent + server** | `tool_daily` table (additive migration), snapshot upload, tool switches in Settings, Tool filter and "By tool" panel in the dashboard, pricing for non-Claude models |
| 12 ✓ | **Desktop app shell** (now with the full main window) | Tauri (or Electron) tray/menu-bar app on macOS, Windows, Linux: popover, settings, sign-in, one-click "Add this device", bundled agent, launch at login |
| 13 | **App releases** | Installers built in CI, auto-update, Homebrew cask; signing per decision D5 |
| 14 | ~~Web app~~ | Dropped (2026-10-03): the web dashboard was removed; the app is the only interface |
| 15 | **Live** (optional) | Durable Object + SSE: open apps update within seconds |

Each UI milestone ends with the anti-slop Delivery Gate, as Milestone 5 did. DESIGN.md is extended for the tray (it's a new surface, so you approve its direction first).

## 8. Risks

| Risk | Mitigation |
|---|---|
| tokscale output or behaviour changes | Pin the version; tolerant JSON reading; CI test against a fixture per tool; port a parser to Go if one becomes unreliable |
| A tool's logs don't record accounts | Tool totals are per device; say so in the UI |
| Double counting Claude | tokscale always runs with Claude excluded |
| Unsigned app warnings | Decide on D5 before sharing; document right-click → Open meanwhile |
| Tray quirks on Linux | Linux gets a plain window option if the tray isn't available |
| Free-plan limits | Snapshot uploads are small (rows per day, not per message); summary endpoint is cached |

## 9. Questions for you

1. **Tauri or Electron?** (D1)
2. **Make the repo public** after the clean-up? (D4)
3. **Apple Developer account** ($99/year) for a signed macOS app, now or later? (D5)
4. **Which tools first?** My suggestion: Codex, Kimi, OpenCode, Gemini/Antigravity.
5. **Order:** my suggestion is 8 → 9 → 10 → 11 → 12, i.e. fast installs and other tools first, then the app.
