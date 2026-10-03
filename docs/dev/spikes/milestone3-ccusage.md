# Milestone 3: totals cross-check with ccusage (2026-10-03)

Same machine, same moment, `~/.claude/projects` (Claude Code 2.1.283).

Input, output, cache-write and cache-read totals from `ccusage claude daily` and from DeviceTally's counting were identical.

Exact match. The end-to-end import (agent → local Worker → D1 rollups) had already matched this counting exactly (replies, subagent replies, prompts and sessions).

Notes:
- Use `ccusage claude …`. Plain `ccusage daily` now adds other coding tools on the machine (OpenCode etc.), so its totals are much higher.
- ccusage also estimates cost from LiteLLM's public price list. That list is a candidate source for DeviceTally's cost estimate.
