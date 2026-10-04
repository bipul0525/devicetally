# Changelog

## 1.2.1

- **Fixed: adding or removing a menu-bar item could freeze DeviceTally** (it had to be force-quit). All menu-bar changes now happen one at a time on the app's main thread.
- **Fixed: making one item large shrank the others.** Large items are now shown at the menu bar's full height, and each item keeps its own size.
- **Fixed: Agent status could stay idle while an agent was working.** The tracker used by Claude Code's hooks was only updated by its own daily check, so after an app update it could stay old. DeviceTally now updates it on start.
- Network panel: total upload and download.

## 1.2.0

- **Menu bar settings redesigned:** a live, clickable preview of your menu bar (light or dark), item tiles, one-click size presets, drag to reorder, and each item's options grouped in cards.
- **Any size from 50% to 200%,** for all items or one; large sizes use the menu bar's full height and the agent ring grows with them.
- **Agent alerts live in Agent status;** the separate Alerts page is gone.
- **"Send a test" always shows something:** macOS blocks system notifications for apps without a paid Apple signature, so DeviceTally shows its own notification in the top-right corner (click it to open DeviceTally).
- Cleaner Safe / Caution / Risky tags in Storage, a softer selected row in the sidebar, button labels without "…", and a larger Settings button.
- Lock this computer leaves Claude Code's transcript cleanup as it is.

## 1.1.0

- **A menu-bar item per module, like Stats:** Agent status, Network, CPU, Memory, Disk, Battery and Clock are separate items, and each opens its own panel over any app: Network shows speeds with live graphs and your connection; CPU shows usage, temperature and top processes; Memory, Disk (with "What's using space?"), Battery (health, cycles, time left), Clock (calendar) and Agents. **Combine into one item** (Menu bar → General) brings back a single item with everything.
- **First launch is simple:** three items (Agent status, Network, CPU temperature) at a normal size, in the menu bar's own colour. The agent ring tells its states apart by shape; state colours are a switch away.
- **Open DeviceTally comes to the desktop you're on** instead of switching you back to the one where it was opened before.
- Delete DeviceTally button: cleaner label.
- **Storage scan no longer triggers macOS permission pop-ups:** it skips other apps' private data (Containers, Mail, Messages, Safari…). Desktop, Documents and Downloads are included only if you tick the box (macOS asks once for each). Faster too.

## 1.0.3

- Joining a computer just says "✓ <name> is connected. Monitoring is on."
- DeviceTally is described as what it is: one menu-bar app for all your computers (AI coding usage, agent status, system monitor, storage, device health).

## 1.0.2

- Joining a computer says what it tracks (e.g. "Tracking: Codex, OpenCode"), notes other AI tools found, and mentions Claude Code only as a note when no account is signed in. A computer without Claude Code is fully supported.
- Running the join command again on a connected computer says "already connected" instead of an error; a used or expired code gets a clear explanation.

## 1.0.1

- **Menu bar tab, like Stats:** a sidebar with icons and on/off switches on the left; the selected item's settings and the live preview on the right, at any window width.
- **Agent status ring:** compact and recognisable at a glance: an orange ring that turns while an agent works, a red ! when it needs you, a green ✓ when it's done, grey when idle. Optional short word beside it. Replaces the pill.
- The menu bar redraws 4 times a second only while an agent is working (the ring turns); system counters are still read every 2 s.

## 1.0.0

The first stable release.

- **Usage across all your computers:** Claude Code in detail (tokens by type, model, project and session; cost matches ccusage), plus Codex, OpenCode and Kimi token totals.
- **Your own server, free:** the app creates it in your Cloudflare account. No one else holds your data.
- **Menu bar you design:** agent status, tokens today, network, CPU, CPU temperature, memory, disk, battery (also with the percentage inside the icon) and clock; per-item label, layout, size and colour; 12 fonts; live preview.
- **Agent status and alerts:** know when Claude Code is working, needs you, or is done (Codex: done), with optional Mac notifications and sounds.
- **Admin dashboard:** Overview with a daily chart by device, Sessions, Devices with health (online, locked, tracking problems, disk forecast), allowed projects, prompts with filters.
- **Storage:** what AI tools, developer caches and big folders use, with Show in Finder and Move to Bin for caches.
- **Lock this computer** (macOS): tracking in Claude Code's system-wide settings, so it can't be turned off without an administrator.
- **In-app updates,** signed and verified before installing.
