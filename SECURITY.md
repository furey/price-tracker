# Security

## Reporting

Open a private security advisory at <https://github.com/furey/price-tracker/security/advisories/new>, or use the "Report a vulnerability" button on the repository's Security tab.

Please keep the details private until a fix is available.

## Supported versions

The project is pre-1.0. Only the latest release receives security fixes; pull `ghcr.io/furey/price-tracker:latest` to get them.

## Scope

Price Tracker is self-hosted. It holds a Claude login token, an ntfy token, your delivery postcode, and your price history, and it reads web pages that anyone can write. Know these properties before you deploy it:

- **Password required off loopback.** Off `127.0.0.1`, `localhost`, and `::1`, the server refuses to start without `APP_PASSWORD`. `SESSION_SECRET` must have at least `32` characters. `ALLOW_NO_AUTH=1` turns this check off; with it, anyone who can reach the port can change your items and settings.
- **Plain HTTP.** The dashboard has no TLS. Keep it on your home network, or put it behind a reverse proxy with TLS or a private VPN such as a tailnet. Do not forward the port to the internet. Behind a proxy you control, set `TRUST_PROXY=1` so the login cookie gets the `Secure` flag.
- **ntfy topics are secrets.** On the public ntfy.sh server, anyone who knows a topic can read its alerts and publish fake ones. Keep topics out of git, and run `node src/cli.js rotate-topics` after the first start. Reserve your topics on an ntfy account with access for you only. The app sends the ntfy token only to `NTFY_TRUSTED_SERVER`.
- **Secrets on disk.** `.env` and `state/price-tracker.db` hold tokens as plain text. Make them readable by your user only, for example `chmod 600 .env state/*.db`. The shipped `.gitignore` keeps both out of version control.
- **Untrusted AI output.** `claude -p` gets the `WebSearch` and `WebFetch` tools only, a fetch allowlist, and a short list of environment variables. It never sees `APP_PASSWORD`, `SESSION_SECRET`, or the ntfy token. Code validates every reply and decides on each alert. A listing on an unknown site, or at an unlikely low price, sends a low-priority notice with no retailer link.
- **Outbound fetches.** Direct checks refuse private, loopback, and reserved addresses, check every redirect, and stop a body at `5 MiB`.
- **Container.** The Docker service:

  - runs as a non-root user
  - drops every Linux capability and sets `no-new-privileges`
  - uses a read-only root file system
  - limits memory and process count

The full model is in [Security model](https://furey.github.io/price-tracker/reference/security).

## Dependencies

The runtime image installs only the production dependencies (`croner`, `express`) and Claude Code. The dashboard ships as built files in `web/dist`; Vite and VitePress never ship in the image.
