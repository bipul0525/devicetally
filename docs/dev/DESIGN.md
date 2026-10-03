# DeviceTally: Design direction

Owner's choices (2026-10-03), transcribed. Lines marked *(derived)* follow from those choices and can be changed.

## Identity

- **Mood:** polished product. Clean, with presence: clear hierarchy, one large focal number per screen, subtle transitions. Taste references: Vercel and Stripe dashboards (references for judging, not to imitate).
- **Dial: ENERGY 2 / RHYTHM 2 / MOTION 2**
- **Design Read:** a personal usage dashboard for one technical owner, in a polished-product style, dial ENERGY 2 / RHYTHM 2 / MOTION 2.

## Palette

One accent: **electric green**. It marks the single most important thing on a screen (the focal number's trend, "active now", the primary action). Nowhere else.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF9` | `#0B0D0C` | page *(derived)* |
| `--surface` | `#FFFFFF` | `#141716` | panels *(derived)* |
| `--ink` | `#16181A` | `#ECEEEC` | text *(derived)* |
| `--muted` | `#5F6661` | `#9AA39D` | secondary text, axes *(derived)* |
| `--line` | `#E4E6E3` | `#262B28` | rules, borders *(derived)* |
| `--accent` | `#00A34A` | `#2BEA7A` | accent fills and marks |
| `--accent-ink` | `#00692F` | `#2BEA7A` | accent used as text (AA on its background) *(derived)* |

Status colors (errors, warnings) are not accents: `--danger` `#B42318` / `#FF7A6B`, `--warn` `#8A5A00` / `#F2C14E` *(derived)*.

Both themes ship and must work (R-34). Default follows the OS; a toggle overrides it.

## Typography

- **Text:** Inter (sans). **Numbers and code:** JetBrains Mono, always with tabular figures, so columns line up.
- Fonts are bundled with the app (no third-party font requests) *(derived from "no data leaves your Cloudflare account")*.
- Scale *(derived)*: 13 / 14 (body) / 16 / 20 / 28 / 44 (focal number only).

## Motif: device chips

Every device has one fixed chip: a small shape plus a color, used in every chart, table, filter and legend, so "Office PC" is recognisable at a glance everywhere.

- Shapes in order: circle, triangle, square, diamond, ring, bar *(derived)*. Shape carries identity on its own, so it works for color-blind users and in print.
- Colors *(derived)*, chosen to stay clear of the accent, all at least 3:1 against both themes: slate blue `#5B7BD5`, amber `#A3700F` (light) / `#D99A2B` (dark), rose `#D45D79`, teal `#2A9DA8`, violet `#8E6CD8`, sand `#A08A5F`.
- A device keeps its chip for life (assigned by order of enrollment).

## Motion (MOTION 2)

- Transitions between views and filter changes: 150 to 200 ms fades and number count-ups on the focal number.
- Charts animate in once, never loop.
- Everything respects `prefers-reduced-motion` (no motion at all).

## Layout (RHYTHM 2)

- Consistent grid with a few deliberate breaks: each page opens with one focal panel (the big number with its chart), then a uniform grid of breakdown panels.
- Left navigation on desktop, bottom bar on mobile. No horizontal page scroll; tables scroll inside their panel.

## Rules that matter most here

Real data only, no sample numbers (R-17, R-38). Designed empty, loading and error states (R-27). WCAG AA contrast (R-25). Full keyboard use with visible focus (R-32). 44 px tap targets on mobile (R-03). Every control does something real (R-26). No em dashes in UI copy (R-02).

## Tray / menu-bar app (Milestone 12)

Owner's choices (2026-10-03), transcribed. Lines marked *(derived)* follow from them.

- **Icon:** the app icon plus **today's tokens** (e.g. `1.7M`) in the macOS menu bar; on Windows and Linux the tray icon with today's tokens in its tooltip (those trays can't show text) *(derived)*.
- **Popover leads with today's total and the by-tool breakdown:** tabs Today / 7 days / 30 days; the focal number is tokens with the API-equivalent cost beside it; then one bar per tool (Claude Code, Codex, OpenCode, Kimi); then devices; then "Open dashboard" and settings.
- **Native look per OS**, not the dashboard's look:
  - System font (SF Pro on macOS, Segoe UI Variable on Windows, the desktop's font on Linux) *(derived)*; numbers still use tabular figures.
  - Native window material: macOS popover vibrancy, Windows 11 Mica (plain on Windows 10), plain on Linux *(derived)*.
  - The **system accent color** replaces electric green, and the window follows the OS light/dark setting *(derived)*.
  - Device chips keep their shapes (the motif) so a device is recognised the same way in the app and the dashboard *(derived)*.
- **Freshness:** every 30 s while the popover is open; the icon text every 5 minutes.
- **Dial: ENERGY 1 / RHYTHM 1 / MOTION 1** *(derived: a native utility should feel like part of the OS)*.
