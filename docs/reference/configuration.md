---
title: Configuration
description: Every environment variable and every setting, the order in which values win, and the files the app reads and writes.
icon: settings-2
---

# Configuration

This page covers the environment variables and the Settings page. See [Item config](/reference/item-config) for the items.

## Where values come from

The CLI loads `.env` from the project root when the file exists. The file is optional, and git ignores it. In Docker, Compose passes the same file to the container with `env_file`.

A value that is also a setting resolves in this order:

1. An override saved on the Settings page (a row in the `settings` table).
2. The environment variable, when it is set and valid.
3. The built-in default, when there is one.

"Use .env value" on the Settings page deletes the override, so the environment variable applies again. The app ignores an environment value that fails validation.

## Settings

Each setting below has a key (used by `PUT /api/settings`) and an environment variable.

| Setting                     | Key                           | Variable                                                       | Default                                           | Rule                                                                                                                         |
| --------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ntfy access token           | `ntfyToken`                   | `NTFY_ACCESS_TOKEN` (or the name in an item's `ntfy.tokenEnv`) | none                                              | no whitespace, up to `256` characters; secret                                                                                |
| Claude login token          | `claudeOauthToken`            | `CLAUDE_CODE_OAUTH_TOKEN`                                      | none                                              | no whitespace, up to `512` characters; secret                                                                                |
| Delivery postcode           | `deliveryPostcode`            | `DELIVERY_POSTCODE`                                            | none                                              | `4` digits for `au`; a ZIP code (`12345` or `12345-6789`) for `us`; `2–12` letters, digits, spaces, or hyphens for `generic` |
| Delivery suburb             | `deliverySuburb`              | `DELIVERY_SUBURB`                                              | none                                              | up to `80` characters, no control characters                                                                                 |
| Monthly AI research cap     | `aiMonthlyCap`                | `AI_MONTHLY_CAP`                                               | `150`                                             | whole number, `0–1000`                                                                                                       |
| Claude weekly reserve       | `claudeReservePercent`        | `CLAUDE_RESERVE_PERCENT`                                       | `70`                                              | whole number, `0–100`                                                                                                        |
| Claude five-hour reserve    | `claudeSessionReservePercent` | `CLAUDE_SESSION_RESERVE_PERCENT`                               | `90`                                              | whole number, `0–100`                                                                                                        |
| Pause all AI                | `aiPaused`                    | `AI_PAUSED`                                                    | `false`                                           | `true` or `false`                                                                                                            |
| App ntfy topic              | `appTopic`                    | `APP_NTFY_TOPIC`                                               | generated                                         | letters, digits, `-`, `_`, up to `64`                                                                                        |
| Memberships                 | `memberships`                 | `MEMBERSHIPS`                                                  | `eBay Plus` for `au`; none for `us` and `generic` | comma list, up to `20` names of up to `40` characters; `none` for no memberships                                             |
| Dashboard URL               | `dashboardUrl`                | `DASHBOARD_URL`                                                | `http://localhost:4280`                           | `http` or `https` URL; a trailing slash is removed                                                                           |
| Currency                    | `currency`                    | `CURRENCY`                                                     | from the region                                   | ISO 4217 code, for example `AUD`; stored in capitals                                                                         |
| Number and date format      | `locale`                      | `LOCALE`                                                       | from the region                                   | one BCP 47 locale, for example `en-AU`                                                                                       |
| Time zone                   | `timeZone`                    | `TIME_ZONE`                                                    | from the region                                   | IANA time zone, for example `Australia/Sydney`                                                                               |
| Screenshot storage cap (MB) | `screenshotCapMb`             | `SCREENSHOT_CAP_MB`                                            | `200`                                             | whole number, `10–5000`; the total size of all Chrome check screenshots                                                      |

- **Secrets**: the API never returns a secret. A set secret shows as `••••••`.
- **Dashboard URL**: alerts and app notices link to this address. Set it to the address you open the dashboard on, for example `http://nas.local:4280`. The built-in default is `http://localhost:4280`, which your phone cannot reach.
- **App ntfy topic**: the app makes one the first time it needs it, in the form `pt-app-<32 hex>`. `node src/cli.js rotate-topics` replaces it.
- **Delivery labels**: with `REGION=us`, the Settings page shows the postcode as "Delivery ZIP code" and the suburb as "Delivery city". The keys and variables stay the same.
- **ntfy token variable**: an item can name its own variable in `ntfy.tokenEnv`. The name must match `NTFY_` followed by capitals, digits, or underscores. Any other name falls back to `NTFY_ACCESS_TOKEN`.

The meaning of the cap, the reserves, and the pause is on [Deciding and alerting](/reference/decisions#limits-on-ai-runs).

## Region

`REGION` picks one region profile for the whole install. It is a server variable, not a setting. The value is not case-sensitive. An unknown value is an error that names the known profiles.

| `REGION`       | Currency | Locale  | Time zone          | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------- | ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `au` (default) | `AUD`    | `en-AU` | `Australia/Sydney` | Australian retailers only; `*.au`, Kogan, and Qantas Marketplace in the fetch allowlist; the OzBargain, eBay AU, and Amazon AU rules; Bunnings PowerPass and Costco gates; Click Frenzy, Black Friday, Cyber Monday, Boxing Day, and EOFY sale windows; Shopify prices on `.au` hosts                                                                                                                                                           |
| `us`           | `USD`    | `en-US` | `America/New_York` | US retailers only; Amazon, Walmart, Target, Best Buy, Home Depot, Lowe's, Costco, B&H, Newegg, eBay, and Slickdeals in the fetch allowlist and the trusted list; the Slickdeals, eBay, Amazon.com, and Walmart.com rules; prices before sales tax; ZIP code delivery; Costco and Sam's Club gates; Presidents' Day, Memorial Day, Prime Day, Labor Day, Black Friday, and Cyber Monday sale windows; Shopify prices on hosts listed on the item |
| `generic`      | `USD`    | `en-US` | `UTC`              | Retailers that sell in the install currency; no fixed fetch domains, trusted retailers, memberships, or sale events; Shopify prices on hosts listed on the item                                                                                                                                                                                                                                                                                 |

The Currency, Number and date format, and Time zone settings override the values of the profile. For example, `REGION=generic` with `CURRENCY=EUR`, `LOCALE=fr-FR`, and `TIME_ZONE=Europe/Paris` gives euro prices in French format. The rules of the profile stay the same. The app has no exchange rates: caps, prices, and `dedupe.minDrop` are plain numbers in the one currency of the install.

The time zone sets "today" in the prompts, the day each price counts for, pause bounds, the heartbeat month, and the default for new schedules. An existing schedule keeps its own `tz`.

Many large US retailers refuse the AI's page fetches; see [Blocked sites](/guide/chrome-observations#blocked-sites). US prices exclude sales tax. With `REGION=us`, the research prompt asks Claude for the listed price and never to add tax, so a cap is a pre-tax amount.

Prime Day dates change each year. The `us` profile places it on the second Tuesday of July, and its sale window runs from `14` days before to `7` days after that date. Black Friday is the day after Thanksgiving (the fourth Thursday of November), and Cyber Monday is three days later.

## Server variables

These variables are not settings. Set them in the environment or in `.env`.

| Variable              | Default                  | Purpose                                                                                                                                  |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                | `127.0.0.1`              | Address the server listens on. The Docker image sets `0.0.0.0`.                                                                          |
| `PORT`                | `4280`                   | Port the server listens on. `install` copies it into the LaunchAgents.                                                                   |
| `APP_PASSWORD`        | none                     | Dashboard password. With it unset, the dashboard needs no login.                                                                         |
| `SESSION_SECRET`      | none                     | Key that signs login cookies. Required when `APP_PASSWORD` is set. At least `32` characters.                                             |
| `ALLOWED_HOSTS`       | none                     | Comma list of `Host` header values (port included) that may use the API, besides `localhost` and `127.0.0.1`.                            |
| `ALLOW_NO_AUTH`       | none                     | `1` lets the server listen on a non-loopback address without `APP_PASSWORD`.                                                             |
| `TRUST_PROXY`         | off                      | Number of proxy hops to trust for `X-Forwarded-For` and `X-Forwarded-Proto`. Any other non-empty value except `0` and `false` means `1`. |
| `NTFY_TRUSTED_SERVER` | `https://ntfy.sh`        | The only ntfy origin that receives the ntfy token.                                                                                       |
| `CLAUDE_BIN`          | `claude`                 | Path to the Claude Code binary. `install` sets it from `command -v claude`.                                                              |
| `CLAUDE_CONFIG_DIR`   | none                     | Claude Code config folder, passed to `claude` only when no Claude login token is set.                                                    |
| `DB_PATH`             | `state/price-tracker.db` | Path to the SQLite database.                                                                                                             |
| `DISABLE_SCHEDULER`   | none                     | `1` stops the daemon from running scheduled checks and the startup Claude usage check. The server and drafts still run.                  |

The server refuses to start when `HOST` is not a loopback address (`127.0.0.1`, `localhost`, or `::1`), `APP_PASSWORD` is unset, and `ALLOW_NO_AUTH` is not `1`. It also refuses to start when `SESSION_SECRET` is shorter than `32` characters, or missing while `APP_PASSWORD` is set.

Generate a secret with `openssl rand -hex 32`.

## Docker variables

`docker-compose.yml` reads these from `.env`:

| Variable       | Default       | Purpose                                                     |
| -------------- | ------------- | ----------------------------------------------------------- |
| `HOST_PORT`    | `4280`        | Port on the host that maps to port `4280` in the container. |
| `PUID`, `PGID` | `1026`, `100` | User and group the container runs as.                       |

Compose also sets `HOST=0.0.0.0`, `PORT=4280`, `TZ=Australia/Sydney` (days and schedules use the Time zone setting, not `TZ`), `NODE_ENV=production`, `HOME=/app/state/home`, `CLAUDE_BIN=claude`, and `DISABLE_AUTOUPDATER=1`.

## The claude child environment

Every `claude` run gets a new environment. It holds only:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `TZ`, `LANG`, `TMPDIR`, every `LC_*` variable, and the proxy variables (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, in both cases).
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, and `DISABLE_AUTOUPDATER=1`.
- `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR=state/claude-config`, when a Claude login token is set (Settings first, then the environment).

## Files

| Path                                   | Holds                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.env`                                 | Environment variables. Never committed.                                                                        |
| `items/*.json`                         | Seed items, read at start. The database is the source of truth after the first import.                         |
| `state/price-tracker.db`               | The database. See [Database](/reference/database).                                                             |
| `state/tick.lock`, `state/claude.lock` | Lock files.                                                                                                    |
| `state/claude-work/`                   | Working folder for research runs.                                                                              |
| `state/claude-config/`                 | Claude Code config and transcripts when a login token is set. Transcripts older than `14` days are cleaned up. |
| `logs/`                                | LaunchAgent logs on a Mac, and the Docker log mount.                                                           |
| `web/dist/`                            | The built dashboard.                                                                                           |
