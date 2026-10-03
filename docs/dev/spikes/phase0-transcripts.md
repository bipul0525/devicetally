# Phase 0: transcript findings (2026-10-03)

Sample: the owner's transcripts (thousands of lines), Claude Code 2.1.283, VS Code extension (`entrypoint: claude-vscode`), macOS. Only field names, types and counts were inspected, not content.

## Answers to the open questions

| Question | Finding |
|---|---|
| Where is effort? | On every `assistant` line: `effort` and `perTurnEffort` (`low` / `medium` / `high`). No need for the hook. |
| Thinking tokens separate? | Yes, when present: `message.usage.output_tokens_details.thinking_tokens` (on ~54% of lines, the rest predate it or have none). Included in `output_tokens`. Keep the column nullable. |
| Subagent transcripts? | Separate files: `<project>/<sessionId>/subagents/agent-<id>.jsonl`, plus `agent-<id>.meta.json` (`agentType`, `description`, `parentAgentId`, `spawnDepth`). Lines also carry `agentId` and `isSidechain`. about half of all assistant lines were subagent usage, so missing these would undercount by about half. |
| Account fields (`~/.claude.json` → `oauthAccount`) | `accountUuid`, `emailAddress`, `displayName`, `organizationName`, `organizationUuid`, `billingType`, `seatTier`, `userRateLimitTier`. There is no single "plan" field; derive it from `billingType` + `seatTier` / rate-limit tier. |
| Model | `message.model`. Ignore `<synthetic>` (error placeholders, `isApiErrorMessage: true`). |
| Title | Separate `ai-title` lines (`aiTitle`), can change during a session: keep the latest. |
| Prompt id | `user` lines have `promptId`: use it as the prompt's idempotency key. |

## Important: one reply is written several times

- One API message (`message.id`, same `requestId`) appears on **several lines**: most message ids were repeated.
- Usually the usage is identical, but sometimes **earlier lines hold partial counts** (e.g. `output_tokens` 8, then 106 on a later line).
- `INSERT OR IGNORE` keeps the first line, so it would **undercount**. Fix (applied in PLAN.md §7):
  - Agent: collapse lines by `message.id` and keep the one with the largest `output_tokens`. Hold back the last message of a file until the session's next sync or `Stop`, since it may still be growing.
  - Server: upsert with `MAX()` per token column and apply only the difference to rollups.

## Other line types seen (ignore unless noted)

`attachment`, `queue-operation`, `file-history-*`, `atis-latch`, `last-prompt`, `frame-link`, `mode`, `system` (API retries/errors: could feed an "errors" stat later), `cost-state` (Claude's own cost totals: useful to cross-check our estimate).

## Still to do in Phase 0

- Async hooks: timing on macOS, Linux, Windows; minimum Claude Code version.
- PBKDF2 CPU time on the free plan.
- D1 writes per turn with real indexes + FTS5.
- Deploy button: D1 provisioning and the `SETUP_TOKEN` prompt.
- Scrubbed fixtures from these transcripts (including a duplicated-message case and a subagent file).
