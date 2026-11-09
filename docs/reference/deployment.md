---
title: Deployment
description: Run Price Tracker in Docker on a NAS or server, or as two LaunchAgents on a Mac.
icon: container
---

# Deployment

Price Tracker runs as either:

- **Docker**: one container runs the dashboard and the 15-minute tick loop. Use it on a NAS or any always-on Linux host.
- **macOS LaunchAgents**: two agents run `tick` and `serve`. Use it on a Mac that stays on.

Both need a Claude subscription and a Claude Code login for the AI research runs. Free direct checks work without one.

## Docker

The `Dockerfile` builds the dashboard in a first stage. The final image is `node:24-bookworm-slim` with Claude Code `2.1.319` installed globally. It runs `node src/cli.js daemon`.

### Docker: install

1. Clone the repository on the host: `git clone https://github.com/furey/price-tracker.git ~/services/price-tracker`.
2. Go to the folder: `cd ~/services/price-tracker`.
3. Copy the example environment file: `cp .env.example .env`.
4. Fill in `.env` (see below).
5. Start the service: `./start.sh`.
6. Open `http://nas.local:4280`.

### Docker: .env

| Variable                               | Set it to                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`              | the token from `claude setup-token`, run on a machine with a browser                                     |
| `APP_PASSWORD`                         | a dashboard password; required because the container listens on all interfaces                           |
| `SESSION_SECRET`                       | the output of `openssl rand -hex 32`                                                                     |
| `ALLOWED_HOSTS`                        | the `Host` values you type in the browser, port included, for example `nas.local:4280,192.168.1.50:4280` |
| `DASHBOARD_URL`                        | the address that alerts open, for example `http://nas.local:4280`                                        |
| `NTFY_ACCESS_TOKEN`                    | optional ntfy token                                                                                      |
| `REGION`                               | optional region profile: `au` (default), `us`, or `generic`                                              |
| `TIME_ZONE`                            | optional IANA time zone for days and new schedules; the default comes from `REGION`                      |
| `DELIVERY_POSTCODE`, `DELIVERY_SUBURB` | optional; research records delivery costs to this place (a ZIP code for `us`)                            |
| `HOST_PORT`                            | optional host port (default `4280`)                                                                      |
| `PUID`, `PGID`                         | optional user and group for the container (default `1026` and `100`)                                     |

`TRUST_PROXY`, `ALLOW_NO_AUTH`, and `NTFY_TRUSTED_SERVER` are also in `.env.example`. `docker-compose.yml` sets the container clock to `TZ: Australia/Sydney`; the app uses `TIME_ZONE` (or the region default) for its own days and schedules, not `TZ`. See [Configuration](/reference/configuration#server-variables).

### Docker: the container

`docker-compose.yml` sets these limits:

- runs as the user `PUID:PGID`
- drops every Linux capability, with `no-new-privileges`
- a read-only root file system, with a `128m` `/tmp`
- `1g` of memory and `256` processes at most
- log rotation at `10m`, with `3` files
- a health check on `GET /health` every `30` seconds

It mounts these folders:

| Host      | Container                | Holds                                                                               |
| --------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `./state` | `/app/state`             | the database, the lock files, and Claude Code's files (`HOME` is `/app/state/home`) |
| `./logs`  | `/app/logs`              | logs                                                                                |
| `./items` | `/app/items` (read-only) | seed items                                                                          |

Edit items in the dashboard. A new seed file imports on the next restart.

### Docker: scripts

| Script      | Does                                                               |
| ----------- | ------------------------------------------------------------------ |
| `start.sh`  | creates `state/` and `logs/`, builds, starts, and follows the logs |
| `stop.sh`   | stops and removes the container                                    |
| `logs.sh`   | follows the logs                                                   |
| `update.sh` | `git pull --ff-only`, then rebuilds and restarts                   |
| `status.sh` | shows the container and its health status                          |

### Docker: move a database

To move an existing database from a Mac to the host:

1. On the host, stop the service: `./stop.sh`.
2. On the Mac, copy the file: `scp state/price-tracker.db <user>@<nas-ip>:services/price-tracker/state/price-tracker.db`.
3. On the host, start the service: `./start.sh`.

## macOS

### macOS: requirements

- macOS
- Node `22.5` or later (the code uses `node:sqlite`)
- Claude Code, installed and logged in, so `claude` runs without a prompt

### macOS: install

```bash
npm install
npm run build
node src/cli.js test-notify karcher-k7
node src/cli.js run karcher-k7 --dry-run
node src/cli.js install
```

`install` resolves the absolute paths of `node` and `claude`, writes two plist files to `~/Library/LaunchAgents/`, and loads them with `launchctl bootstrap`. It fails when it cannot find `claude` on `PATH` or in `CLAUDE_BIN`.

| Label                         | Runs                                   | Logs                                     |
| ----------------------------- | -------------------------------------- | ---------------------------------------- |
| `com.furey.price-tracker`     | `tick` every `900` seconds and at load | `logs/tick.out.log`, `logs/tick.err.log` |
| `com.furey.price-tracker.web` | `serve`, kept alive                    | `logs/web.out.log`, `logs/web.err.log`   |

Each agent runs in the project root with `PATH`, `HOME`, `CLAUDE_BIN`, and `PORT` set. The dashboard is at `http://127.0.0.1:4280`.

### macOS: update

After a change to the dashboard, run `npm run build`. Then run `node src/cli.js install` to reload both agents.

### macOS: uninstall

`node src/cli.js uninstall` unloads and removes both agents. The database and logs stay on disk.

## Reaching the dashboard

> [!IMPORTANT]<br>
> The dashboard speaks plain HTTP. Keep it on your home network. For access from outside, put it behind a reverse proxy with TLS, or reach it over a private VPN such as a tailnet. Do not forward the port to the internet.

Behind a reverse proxy, set `TRUST_PROXY=1`, so the login cookie gets the `Secure` flag and the rate limit sees the real client address. Set it only for a proxy you control.
