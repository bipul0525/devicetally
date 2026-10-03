# What DeviceTally collects

Everything goes to **your own** Cloudflare Worker and D1 database. Nothing is sent anywhere else: no analytics, no third-party requests, fonts are bundled.

## Read on each device

| Source | What is read |
|---|---|
| `~/.claude/projects/**/*.jsonl` (transcripts) | Per reply: message id, time, model, effort, token counts (input, output, cache write incl. 1-hour part, cache read, thinking). Per prompt: id, time, text. Per session: id, working folder, git branch, title, client (CLI or VS Code), Claude Code version. Tool calls, file contents and Claude's replies are **not** read. |
| `~/.claude.json` → `oauthAccount` | Account id, email, name, organization, plan tier: to label usage and to check your approval list. |
| `.git/config` in the working folder | The `origin` remote URL, to recognise the same project across machines. |

Lines Claude Code writes itself (tool results, system reminders, task notifications, subagent instructions) are not treated as prompts.

## Applied on the device, before upload

In this order, on every upload path (live and history import):

1. **Account allowlist.** Data from accounts you haven't approved is dropped. The account's id and email are reported once so the dashboard can ask you to approve it.
2. **Pause and excluded folders.**
3. **Your settings** (most specific wins: project, device, account, everywhere): prompt text, session titles, full paths (off sends the folder name only), git remote and branch, subagent usage, token counts, model and effort.
4. **Secret redaction** (on by default) in prompts and titles: API keys (Anthropic, OpenAI-style, AWS, GitHub, Slack, Google), JWTs, bearer tokens, credentials in URLs, private key blocks, `password=`/`token:`-style assignments and `.env`-style lines become `[REDACTED]`.

## Stored on the server

What arrives after those filters, plus daily totals. Prompt text is deleted after 90 days by default (configurable, including forever); usage totals are kept. **Settings → Your data** exports everything (JSON) or deletes by device, account, project or date range.

## Changes to your machine

The agent adds three hooks (SessionStart, UserPromptSubmit, Stop) to `~/.claude/settings.json`, after saving a backup next to it, and keeps its own files in `~/.devicetally` (`%LOCALAPPDATA%\devicetally` on Windows). `devicetally uninstall` removes both. It never modifies Claude Code's transcripts.

## The tray app

The app is the only interface (the web dashboard was removed). On a connected computer it shows that computer's token counts and session times only: no prompts, no session titles (they are written from prompts), no other computers. The admin sees every device; prompt text is reachable only from Settings → Prompts, and only with the admin login. When a computer is connected, the app says once that its usage, including prompt text if the admin collects it, goes to the server's admin.

When you sign in, the app saves a **session token** (not your password) in its settings folder, in `session.json` with owner-only permissions (macOS/Linux mode 600; your user profile on Windows). It is not in the macOS Keychain because an app without a paid Apple Developer ID can't keep Keychain permission across updates, so macOS would ask for your password again and again. Anything running as your user account could read that file; signing out deletes it, and **Settings → Sign out everywhere** (admin) invalidates it on the server.
