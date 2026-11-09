---
title: Security model
description: Who can reach the app, what the login protects, how the app limits the AI and its own web fetches, and what an operator must do.
icon: shield-check
---

# Security model

Price Tracker holds a Claude login token, an ntfy token, your delivery postcode (or ZIP code), and your price history. It reads text from web pages that anyone can write. The defences below cover the dashboard, the AI runs, the app's own web fetches, and the alerts.

## What you must do

- **Set a password.** On any address other than loopback, set `APP_PASSWORD` and a `SESSION_SECRET` of at least `32` characters. The server refuses to start without them unless `ALLOW_NO_AUTH=1`.
- **Keep the dashboard private.** It speaks plain HTTP. Keep it on your home network, put it behind a reverse proxy with TLS, or reach it over a private VPN. See [Deployment](/reference/deployment#reaching-the-dashboard).
- **Protect the files.** `.env` and `state/price-tracker.db` hold secrets as plain text. Make them readable by your user only, for example `chmod 600 .env state/*.db`.
- **Keep ntfy topics private.** On the public ntfy.sh server, anyone who knows a topic can read it and publish to it. Keep topics out of git, run `node src/cli.js rotate-topics` after the first start, and reserve your topics on an ntfy account with access for you only.

## Dashboard login

When `APP_PASSWORD` is set:

- **Password check**: the server hashes the password with scrypt at start, and compares each attempt in constant time.
- **Session cookie**: `pt_session` holds an expiry time and an HMAC-SHA256 signature. It lasts `30` days, with `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS requests.
- **Signing key**: the key comes from `SESSION_SECRET` and the password together. A new password ends every session.
- **Failed logins**: after `5` failures in `15` minutes from one address, each attempt waits. The wait starts at `30` seconds and doubles up to `15` minutes. A correct password clears the count.

Every `/api` route needs the cookie except `/api/session`, `/api/login`, and `/api/logout`. `/health` returns only `{ ok: true }`.

## Request checks

- **Host allowlist**: every `/api` request must name `localhost`, `127.0.0.1`, or a value in `ALLOWED_HOSTS` in its `Host` header. This blocks DNS rebinding.
- **Cross-site requests**: a request that changes data must come from the app's own origin and carry `Content-Type: application/json`. With the `SameSite=Strict` cookie, this blocks cross-site request forgery.
- **Headers**: every response sets a strict `Content-Security-Policy` (`'self'` only, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. The `X-Powered-By` header is off.
- **Errors**: a server fault returns `Internal server error` with no detail.
- **Secrets**: the API never returns a token. A set token shows as `••••••`.
- **Settings keys**: `PUT /api/settings` accepts only known keys, and validates each value.
- **SQL**: every query uses bound parameters.

## AI runs

The app treats everything Claude returns as untrusted data.

- **Tools**: `claude -p` gets `WebSearch` and `WebFetch` only. It cannot run commands, read files, or use MCP servers. Injected page text cannot reach the shell or the disk.
- **Fetch allowlist**: `WebFetch` may open only the hosts in its [allowlist](/reference/research-contract#the-command) and the sites and direct URLs of the item.
- **Environment**: the child process gets a short [allowlist of variables](/reference/configuration#the-claude-child-environment). It never sees `APP_PASSWORD`, `SESSION_SECRET`, or the ntfy token.
- **Isolation**: the child runs with `CLAUDE.md` files, auto memory, and slash commands off. With a login token set, it uses its own config folder in `state/claude-config/`.
- **Time limit**: the app kills a run that passes its timeout, with its whole process group.
- **Output limits**: the reply must match the schema. Lists, text lengths, and prices have upper limits. URLs must be public `http` or `https` addresses. See [Research contract](/reference/research-contract#validation).
- **Decisions in code**: the model never decides whether to alert. A listing on an unknown site, or at an unlikely low price, sends a low-priority "check this listing" notice. That notice has no link to the retailer. See [Listing checks](/reference/decisions#listing-checks).
- **Wizard output**: the server sets the item id, the ntfy server and topic, the model, the turn limits, and the schedules. Claude cannot set them. Text that reads like an instruction to the AI shows as a warning on the review screen.

## Outbound fetches

Direct checks, the URL tests, and the wizard's link checks use `safeFetch` in `src/safe-url.js`:

- **URLs**: `http` or `https` only, with no user name, no password, and no port.
- **Private addresses**: the app looks up each host when it connects. It refuses loopback, private, link-local, carrier-grade NAT, and other reserved ranges, in IPv4 and IPv6.
- **Redirects**: the app follows up to `5` redirects itself, and checks each new URL again.
- **Size**: a body stops at `5 MiB` after decompression.
- **Time**: each request times out after `25` seconds.
- **Variant filters**: `variantFilter` takes plain words only. A filter cannot hang the process, because the app never runs it as a regular expression.

## Alerts

- **ntfy token**: the app sends the token only to the origin in `NTFY_TRUSTED_SERVER` (default `https://ntfy.sh`). An item that names another server gets no token. `ntfy.tokenEnv` must name a variable that starts with `NTFY_`, so an item cannot send another secret.
- **ntfy server**: an item's server must use `https`, except on `localhost`.
- **Topics**: the app makes topics in the form `pt-<name>-<32 hex>`, which are hard to guess.
- **Text**: alert text has em dashes, en dashes, and emoji removed before it leaves the app.

## Container

The Docker service runs as a non-root user, drops every Linux capability, sets `no-new-privileges`, and uses a read-only root file system. It has limits on memory and process count. The seed items mount read-only. See [Deployment](/reference/deployment#docker-the-container).
