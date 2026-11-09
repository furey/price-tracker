---
title: Architecture
description: One Node program, a 15-minute tick, AI research and free direct checks, decisions in plain code, history in SQLite, and alerts through ntfy.
icon: network
---

# Architecture

<Diagram name="architecture" alt="Claude Code research and free direct checks of retailer pages feed price-tracker, which ticks every 15 minutes, decides in code, and keeps history in SQLite. It sends alerts through ntfy over the internet, and serves the dashboard, the HTTP API, and the CLI on your network." />

Claude Code collects facts from the web. Plain Node code decides what those facts mean. The code never asks the model whether a listing is a deal.

## Processes

The same code runs as either:

- **Docker** (`node src/cli.js daemon`): one process serves the dashboard and runs the tick loop every `15` minutes. See [Deployment](/reference/deployment).
- **macOS LaunchAgents** (`node src/cli.js install`): one agent runs `tick` every `900` seconds and at load. A second agent runs `serve` and keeps it alive.

Both read and write one SQLite database, `state/price-tracker.db`. Lock files in `state/` stop work from overlapping:

| Lock          | Holder                                                                | Effect                                                                                                        |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tick.lock`   | `tick` and `run`                                                      | A second tick or run stops with a message. "Run now" returns `409`.                                           |
| `claude.lock` | every `claude` run (research, draft steps, usage refresh, login test) | Only one AI job runs at a time. A research slot that falls due while a draft holds it moves to the next tick. |

A lock file holds the process id and start time. A lock whose process is gone is stale, and the next holder replaces it. The daemon deletes both lock files when it starts.

## One tick

<Diagram name="run-flow" alt="Every 15 minutes the daemon tick finds the items with a due cron slot. Each due slot runs either an AI research run with Claude Code or a free direct check of the retailer page. Both paths go through validation of the research JSON, tuning, and the decision in code, which store the history in SQLite and send an alert through ntfy." />

Each tick does these steps, in order:

1. Mark runs that a crash left `running` as failed, with the error `interrupted`.
2. Send an app notice when the [Claude usage guard](/reference/decisions#limits-claude-usage-guard) starts or stops skipping AI runs.
3. For each active item, work out whether a research slot and a direct slot are due.
4. Run each due check, one at a time.

A slot is due when a cron time of the item passed since the last successful (or skipped) run of that mode. An item with no such run looks back `14` days. An item runs at most once per mode per tick, for the latest missed slot only. A Mac that slept for a week runs one catch-up check.

The tick skips a research check, with no run row, when:

- the last research run failed less than `2` hours ago, or
- this month's research runs (in the time zone of the install) reached the monthly AI cap.

When the Claude usage guard holds a research check, the tick stores it as `skipped`. A skipped run is not a failure, so the 2-hour delay does not start.

## One check

```text
research run:  claude -p  ->  JSON  ->  validate  ->  normalise  ->  decide  ->  store  ->  alert
direct check:  fetch page ->  parse ->  listings  ->  normalise  ->  decide  ->  store  ->  alert
```

1. **Collect.** A research run spawns `claude -p` with web tools only. A direct check fetches each product URL and reads the price with the `shopify` or `jsonld` parser. See [Research contract](/reference/research-contract).
2. **Validate.** The JSON must match the schema. If it does not, the run asks Claude once more for valid JSON. A second failure fails the run.
3. **Normalise.** Retailer names map to the source names of the item, and every eBay listing becomes `eBay AU` with the seller in the notes. Listings that need a membership you do not hold become rejects. Tuning marks muted listings.
4. **Decide.** Code filters, qualifies, ranks, and dedupes the listings. See [Deciding and alerting](/reference/decisions).
5. **Store.** Every listing, rejects included, goes into the `listings` table with the run.
6. **Alert.** The app stores the alert row first, then sends it to ntfy, then records whether ntfy accepted it.

## The dashboard

`serve` (or `daemon`) starts an Express 5 server. It serves the built Vue app from `web/dist` and the JSON API under `/api`. The app uses hash routes such as `#/item/<id>` and `#/settings`, so every page loads `index.html`. Old `#/watch/<id>` and `#/watches` links redirect to the matching item route. The default address is `127.0.0.1:4280`. The Docker image sets `HOST=0.0.0.0`.

## New-item drafts

The new-item wizard stores each draft in the `drafts` table. A draft worker in the server process (`serve` or `daemon`) takes queued steps one at a time and runs each one under `claude.lock`. A draft survives a closed tab and a restart. A step that was running when the process stopped shows as stopped, with Retry. The app deletes drafts not touched for `14` days.

## Source map

| Area                | Files                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Entry points        | `src/cli.js`, `src/daemon.js`, `src/launchd.js`, `src/server.js`                                             |
| Scheduling and runs | `src/schedule.js`, `src/runner.js`, `src/lock.js`                                                            |
| Collecting prices   | `src/research.js`, `src/direct.js`, `src/safe-url.js`, `src/url-rules.js`                                    |
| Deciding            | `src/validate.js`, `src/decide.js`, `src/retailers.js`, `src/memberships.js`, `src/kits.js`, `src/tuning.js` |
| Alerts              | `src/notify.js`, `src/app-notice.js`, `src/links.js`, `src/text.js`                                          |
| Storage             | `src/db.js`, `src/item-store.js`, `src/settings.js`                                                          |
| AI limits           | `src/ai-usage.js`, `src/claude-guard.js`, `src/claude-usage.js`, `src/claude-check.js`                       |
| Wizard              | `src/drafts.js`, `src/draft-*.js`                                                                            |
| Tuning evidence     | `src/suggestions.js`, `src/site-stats.js`, `src/sale-windows.js`, `src/tuning-data.js`                       |
| Dashboard           | `web/src/` (Vue 3, no router, no chart library)                                                              |
