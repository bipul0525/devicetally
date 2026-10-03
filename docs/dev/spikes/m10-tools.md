# Milestone 10: other AI coding tools via tokscale (2026-10-03)

tokscale 4.17.0 (pinned), macOS arm64, on the owner's Mac. Only aggregate token counts were inspected.

## Tools found

| Tool | Found by tokscale | Checked against | Result |
|---|---|---|---|
| OpenCode | yes (`opencode.db`) | ccusage `opencode` | input, output, cache read, cache write identical |
| Codex | yes (`~/.codex/sessions`) | ccusage `codex` | identical |
| Kimi (CLI + Kimi Code) | yes (`~/.kimi/sessions`, `~/.kimi-code`) | own count of the raw files | identical (106 messages) |
| Claude Code | yes | ccusage `claude` | identical (DeviceTally keeps its own Claude reader; tokscale runs with Claude excluded) |
| Gemini CLI / Antigravity | no local data found | | Antigravity IDE needs `tokscale antigravity sync` (talks to the running app): later |
| Cursor | not local | | needs a Cursor login cookie: later, optional |

Kimi Code writes each reply's usage twice (`usage.record` and inside `context.append_loop_event`); only `usage.record` counts. A naive count doubles the total, which is why a maintained parser is worth using.

## Speed: the important finding

- `npx @tokscale/cli …` took **~31 s per run**, even for one tool with one message. The time was tokscale downloading prices (LiteLLM timed out on this network), not parsing.
- With `TOKSCALE_PRICING_CACHE_ONLY=1` and the binary run directly: **0.25 s** for every tool (`models`), **0.03 s** for the daily `graph`. Totals unchanged.
- So the agent must: run the bundled binary directly (no npx), always set `TOKSCALE_PRICING_CACHE_ONLY=1`, and ignore tokscale's costs (the server prices from tokens).

## Output we will use

`TOKSCALE_PRICING_CACHE_ONLY=1 tokscale graph --no-spinner -c <enabled tools> [--since YYYY-MM-DD]`

```json
{ "contributions": [ { "date": "2026-10-02", "clients": [
  { "client": "codex", "modelId": "gpt-…", "providerId": "openai",
    "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0 },
    "cost": 0.0, "messages": 1 } ] } ] }
```

Per day × tool × model: exactly the `tool_daily` snapshot rows in PLAN-desktop.md. Daily totals summed equal the `models` report.

Notes:
- JSON keys are camelCase (`cacheRead`, `messageCount`, `modelId`); `graph` prints JSON by default and rejects `--json`. Read fields tolerantly.
- `--opencode`-style flags don't exist; filter with `-c a,b,c`.
- Days are the device's local days. The server cuts days in the owner's time zone, so tool days on a device in another zone may differ by a day at the edges. Accept and document, or pass `--since` per device zone.
- tokscale keeps a cache in `~/.config/tokscale`. The binary is 17 MB (darwin arm64).

## Decision

Go: bundle tokscale (pinned) for OpenCode, Codex and Kimi now; add tools as people turn them on. Antigravity and Cursor wait.
