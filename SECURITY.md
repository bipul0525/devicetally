# Security

DeviceTally runs on your own Cloudflare account; there is no shared service holding anyone's data. See [docs/privacy.md](docs/privacy.md) for what is collected and where it goes.

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository. Please don't open a public issue. You'll get a reply within a few days.

## What to know

- App updates are signed; the app checks the signature before installing.
- Tracker downloads are checked against `checksums.txt`, which is signed with Sigstore cosign by the release workflow.
- The Cloudflare API token used to create or update your server is used once and never stored.
- The admin session is kept on your computer in a file only your user can read.
