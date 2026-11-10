---
title: CLI
description: Every command of node src/cli.js, with its options and what it prints.
icon: terminal
---

# CLI

Run each command from the project root as `node src/cli.js <command>`. In Docker, prefix it with `docker exec price-tracker`. The CLI loads `.env` first, opens the database, and imports any new seed items before it runs the command. An error prints `Error: <message>` and exits with code `1`.

## Checks

| Command                                         | Does                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tick`                                          | runs every item that is due, one at a time; the LaunchAgent and the daemon call this                                                                                                                                    |
| `run <id>`                                      | runs one AI research check now and prints the decision and the delivery result                                                                                                                                          |
| `run <id> --dry-run`                            | runs the research and prints the JSON, the decision, and the messages it would send; stores only the run row                                                                                                            |
| `run <id> --direct`                             | runs only the free direct checks; combine with `--dry-run` to preview                                                                                                                                                   |
| `research <id>`                                 | prints the research JSON only; no decision, no alert, no history                                                                                                                                                        |
| `record <id> <file.json> [--screenshots <dir>]` | imports hand-checked prices in the [research reply](/reference/research-contract#the-reply) shape as a `manual` run; never sends an alert. `--screenshots` attaches the PNG, JPEG, and WebP files in `<dir>` to the run |
| `sweep [--json]`                                | prints a Claude in Chrome prompt that checks every blocked page of the active items, or with `--json` the list of pages; see [Chrome sweep](/guide/chrome-observations#chrome-sweep)                                    |

`run` and `tick` share `state/tick.lock`. When one holds it, the other stops with a message. `run` refuses an archived item, and `run --direct` refuses an item with no direct entries.

```bash
node src/cli.js run karcher-k7 --dry-run
node src/cli.js run springfree-medium-oval --direct --dry-run
node src/cli.js record springfree-medium-oval chrome-2026-11-07.json
```

## Items

| Command                           | Does                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                          | prints, per item: status, version, last run, last success and next slot for research and for direct checks, and last alert (not counting test alerts) |
| `history <id> [--days 30]`        | prints a table of the lowest price per retailer, category, and day                                                                                    |
| `pause <id> [--until YYYY-MM-DD]` | pauses scheduled checks; with `--until`, they resume at midnight on that day, in the time zone of the install                                         |
| `resume <id>`                     | resumes scheduled checks                                                                                                                              |
| `export <id>`                     | prints the current config JSON, ready to save as a seed file                                                                                          |
| `test-notify <id>`                | sends a test alert to the item's ntfy topic                                                                                                           |
| `rotate-topics`                   | gives every item a new random ntfy topic (as a new version) and gives the app a new topic                                                             |
| `pin-seeds`                       | marks the current seed files as applied, so a changed seed stops logging a warning; the items do not change                                           |
| `normalise`                       | rewrites stored retailer names in `listings` and `alerts` to the canonical names, and prints the counts                                               |

```bash
node src/cli.js history karcher-k7 --days 14
node src/cli.js export karcher-k7 > items/karcher-k7.json
```

Times in `status` and `history` are in the time zone of the install (the Time zone setting), and prices use its currency and number format. Set `REGION` before a command to pick the profile, for example `REGION=us node src/cli.js run <id> --dry-run`. After `rotate-topics`, subscribe your phone to the new topics. The seed files keep their old topics.

## Services

| Command     | Does                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `serve`     | starts the dashboard and the draft worker on `HOST`:`PORT` (default `127.0.0.1:4280`)                          |
| `daemon`    | starts the dashboard, the draft worker, and the 15-minute tick loop in one process; the Docker image runs this |
| `install`   | builds the dashboard if `web/dist` is missing, writes both LaunchAgents, and loads them                        |
| `uninstall` | unloads and removes both LaunchAgents; history and logs stay on disk                                           |

`daemon` also does these at start:

- deletes stale lock files
- creates `HOME` when it is missing
- reads Claude usage once, when no reading is younger than `6` hours

On `SIGTERM` or `SIGINT`, `serve` and `daemon` stop the server and wait up to `8` seconds for the running work to finish.

See [Deployment](/reference/deployment) for the LaunchAgent details.
