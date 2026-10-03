# DeviceTally: onboarding and roles (agreed 2026-10-03)

DeviceTally is for **one owner using several computers** (not a team). The owner is the **admin**; every other computer is just **tracked**.

## Roles

**Admin (the owner, in the app):** every control lives here.
- Which Claude / tool accounts are tracked (approve or ignore), prompt text collection, other AI tools, retention, export, delete.
- Devices: invite (code + ready-to-send instructions), rename, disconnect.
- Everything that is recorded: overview, sessions, projects, models, prompts (deep in Settings, only if collected).
- Several saved servers, switchable.

**A joined computer (the app or the terminal agent):** no controls, no choices.
- Installs, joins with a code, tracks in the background.
- Shows its own token usage only, for the accounts the admin approved: by date (today / week / month), sessions (date, time, duration, tokens), projects.
- Nothing else: no prompts, no other computers or accounts, no settings beyond "open at login" and "disconnect".

## Onboarding: same path from the app or the terminal

First launch asks one question, "How will you use DeviceTally?":

1. **Set up DeviceTally (first time)**: guided, in-app:
   1. "DeviceTally keeps your data in your own free Cloudflare account." Button: *Create a free Cloudflare account* (or *I have one*).
   2. Button: *Create an access token*: opens Cloudflare's token page with the needed permissions pre-filled; the app shows a screenshot-free 3-step instruction (click Continue, Create, Copy).
   3. Paste the token → the app creates the database, uploads the server, applies tables, turns on the free `workers.dev` address, sets the setup secret. Progress shown step by step; any error explained in plain words with what to do.
   4. Choose your email and password (the admin login). The token is not stored.
   5. "Add this computer" happens automatically; history imports.
2. **Join with a code**: someone (you, on your other computer) gave you a server address and a code. Enter both, done.
3. **Sign in as admin**: you already have a server; sign in to manage it from this computer too.

Terminal equivalents, same steps and wording: `devicetally setup` (needs the token), `curl …/i/CODE | sh` (join), and the app for admin sign-in. If the agent was installed from the terminal, the app detects it and shows "Connected".

Empty fields show hints ("Paste the code from your admin"), never example values that look filled in.

## Work order

1. Spike: create the server through Cloudflare's API (D1, script upload with bindings, workers.dev, secret, cron) on a temporary server; confirm the token permissions list for the pre-filled link.
2. Onboarding screens in the app (three paths) + automatic server creation + admin login.
3. Joined-computer view: minimal (tokens by date, sessions, projects); everything else removed from that view.
4. Admin view: People/accounts first, devices with invite message, server switcher.
5. Terminal parity (`devicetally setup`), README rewritten around the app.
6. Fresh run-through on a clean Mac as admin and as a joined computer, then release.
7. **Update server** in the app (admin): paste a Cloudflare token again; the app uploads its bundled server and applies new migrations. Needed because app-created servers have no checked-out code for `npm run update`.

## Next: system stats and a customizable menu bar (agreed 2026-10-03)

- One menu-bar item the user composes: tokens today, network ↓/↑, CPU %, memory %, disk free, **battery** (% and charging), **clock/date**, in any order.
- Compact by design: side by side or stacked (two tiny lines), small/tiny text, tight/normal/loose spacing, optional letter labels; live preview in Settings. Goal: users can hide macOS's own battery/clock items and use smaller ones here.
- Popover "This computer" strip (CPU, memory, disk, network, battery); admin Devices shows each computer's last CPU/memory/disk.
- Cheap: menu-bar values every 2 s from system counters, tokens every 5 min, nothing extra while the popover is closed.
