# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Layout

| Folder | What | Tests |
|---|---|---|
| `agent/` | The tracker on each computer (Go, single binary) | `cd agent && go test ./...` |
| `worker/` | The server (Cloudflare Worker, Hono, TypeScript) and D1 migrations | `cd worker && npm ci && npm test` |
| `app/` | The menu-bar app (Tauri: Rust + Preact) | `cd app/src-tauri && cargo test`; build with `cd app && npm ci && npm run app` |
| `scripts/` | Installers | |

Design notes live in [docs/dev](docs/dev).

## Rules that keep DeviceTally trustworthy

- Hooks must never slow Claude Code down: they only write locally; uploads happen in the background.
- Filter and redact on the device, before anything is uploaded.
- Database migrations are forward-only and additive.
- Parser bugs: add a fixture and a failing test first.
- Keep it small: reuse, then the standard library, then the platform.
