---
title: HTTP API
description: Every route the server answers, with its request body, its response, and the checks that run before it.
icon: globe
---

# HTTP API

The server in `src/server.js` answers JSON under `/api`. The dashboard uses the same routes. The routes for drafts are in `src/draft-routes.js`, and the routes for tuning suggestions are in `src/suggestion-routes.js`.

## Request rules

Every request under `/api` passes these checks, in order:

1. **Host**: the `Host` header must be `localhost` or `127.0.0.1` (any port), or a value in `ALLOWED_HOSTS`. Otherwise: `403 Host not allowed`.
2. **Origin**: for a method other than `GET`, `HEAD`, and `OPTIONS`, an `Origin` header (when present) must be the server's own origin. For `localhost`, the Vite dev server on port `5173` also counts. Otherwise: `403 Cross-origin request rejected`.
3. **Content type**: for the same methods, the request must have `Content-Type: application/json`, even with no body. Otherwise: `415`.
4. **Session**: when `APP_PASSWORD` is set, every route except `/api/session`, `/api/login`, and `/api/logout` needs a valid session cookie. Otherwise: `401 Login required`.

A body may be up to `2 MB`. An error response is `{ "error": "<message>" }`, sometimes with an `errors` list. An unknown route under `/api` returns `404 Unknown endpoint`. A server fault returns `500 Internal server error` with no detail.

```bash
curl -s http://127.0.0.1:4280/api/items
curl -s -X POST http://127.0.0.1:4280/api/items/karcher-k7/run \
  -H 'Content-Type: application/json' -d '{"dryRun":true}'
```

With a password set, log in first and keep the cookie:

```bash
curl -s -c jar -X POST http://127.0.0.1:4280/api/login \
  -H 'Content-Type: application/json' -d '{"password":"<password>"}'
curl -s -b jar http://127.0.0.1:4280/api/items
```

## Health and session

| Method | Path           | Notes                                                                                                   |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`      | `{ ok: true }`; outside `/api`, so no checks apply                                                      |
| `GET`  | `/api/session` | `{ authRequired, authenticated }`                                                                       |
| `POST` | `/api/login`   | body `{ password }`; sets the session cookie; `401` for a wrong password, `429` after repeated failures |
| `POST` | `/api/logout`  | clears the session cookie                                                                               |
| `GET`  | `/api/about`   | `{ version, database }`; `database` is the file name only                                               |

## Items

| Method   | Path                               | Notes                                                                                                                                       |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/items`                       | every item with status, version, schedules, next slots, last run, last alert, and recent prices                                             |
| `GET`    | `/api/items/:id/config`            | `{ version, status, pausedUntil, origin, config, versions, lowestByCategory }`                                                              |
| `GET`    | `/api/items/:id/versions/:version` | one stored version with its config                                                                                                          |
| `PUT`    | `/api/items/:id/config`            | body `{ baseVersion, config, note }`; saves a new version; `409` when `baseVersion` is stale or the schedules would pass the monthly AI cap |
| `POST`   | `/api/items/:id/pause`             | body `{ until? }` (`YYYY-MM-DD`)                                                                                                            |
| `POST`   | `/api/items/:id/resume`            |                                                                                                                                             |
| `POST`   | `/api/items/:id/archive`           |                                                                                                                                             |
| `POST`   | `/api/items/:id/restore`           | restores an archived item                                                                                                                   |
| `DELETE` | `/api/items/:id`                   | body `{ confirm: "<id>" }`; only for an archived item; returns `{ deleted, removed }` with row counts                                       |

Pause, resume, archive, and restore return the item as `GET /api/items` describes it.

## Runs and checks

| Method | Path                           | Notes                                                                                                                                  |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/items/:id/run`           | body `{ dryRun?, runAnyway? }`; starts an AI research run in a new process; `202 { started: true }`                                    |
| `POST` | `/api/items/:id/test-notify`   | sends a test alert; `{ delivered, tokenWithheld }`                                                                                     |
| `POST` | `/api/items/:id/direct/test`   | body `{ entry }`; fetches one direct entry and returns its listings, with nothing stored                                               |
| `POST` | `/api/items/:id/observations`  | body is a [research reply](/reference/research-contract#the-reply); stores a manual run; `201 { runId, listingCount, qualifiedCount }` |
| `GET`  | `/api/items/:id/runs?limit=20` | recent runs; `limit` up to `200`                                                                                                       |
| `GET`  | `/api/runs/:id`                | one run with its listings                                                                                                              |

`POST /run` returns `409` when:

- the item is archived
- `tick.lock` is held (a run is in progress)
- the monthly AI cap is reached
- `claude.lock` is held (`AI busy: <job>`)
- the Claude usage guard holds AI runs and `runAnyway` is not `true`; the body adds a `guard` object

## History and alerts

| Method | Path                                         | Notes                                                                                                  |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/items/:id/history?days=30`             | `{ daily, listings }`; `daily` is the lowest price per retailer, category, and day; `days` up to `365` |
| `GET`  | `/api/items/:id/insights?days=90`            | `series`, `bestDays`, `dealWindows`, `priceChanges`, `retailers`, and `kits`; `days` up to `730`       |
| `GET`  | `/api/items/:id/observations?day=YYYY-MM-DD` | every listing seen that day in the item's time zone                                                    |
| `GET`  | `/api/alerts?itemId=&limit=50`               | recent alerts; `limit` up to `500`                                                                     |
| `GET`  | `/api/alerts/:id`                            | the alert with its listing, evidence, rule, rank, dedupe check, and run sources                        |

## Tuning and feedback

| Method | Path                                 | Notes                                                                                                    |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/items/:id/tuning`              | body `{ baseVersion, changes, by, reason?, note?, feedback? }`; saves a version with source `tune`       |
| `GET`  | `/api/items/:id/feedback?limit=50`   | feedback rows; `limit` up to `500`                                                                       |
| `POST` | `/api/items/:id/feedback`            | body `{ reason, by, note?, alertId? }`; `201 { feedbackId }`                                             |
| `GET`  | `/api/items/:id/suggestions`         | `{ version, suggestions, held, waiting, ... }`                                                           |
| `POST` | `/api/items/:id/suggestions/dismiss` | body `{ suggestionId, by, permanent? }`; `201 { feedbackId }`                                            |
| `POST` | `/api/items/:id/suggestions/restore` | body `{ suggestionId, by }`; `201 { feedbackId }`                                                        |
| `GET`  | `/api/items/:id/site-stats?days=30`  | results by source; `days` is `30` or `90`; each row has `botCheck` `{ at, note }` or `null`              |
| `GET`  | `/api/bot-checks`                    | `{ checks }`: unseen bot checks on active items, newest first                                            |
| `POST` | `/api/bot-checks/seen`               | body `{ checks, by? }`; `201 { seen }`; marks the listed bot checks seen                                 |
| `GET`  | `/api/sweep`                         | `{ items }`: blocked pages on active items for a [Chrome sweep](/guide/chrome-observations#chrome-sweep) |
| `GET`  | `/api/tuning/failing-sites`          | sites that blocked or failed on every item                                                               |

Each entry of `changes` has a `kind`: `mute-category`, `unmute-category`, `mute-site`, `weekly-site`, `restore-site`, `mute-search`, `restore-search`, `disable-direct`, `restore-direct`, `never`, or `restore-never`. A feedback `reason` is `not-this-model`, `not-this-product`, `price-too-high`, or `not-now`. `by` is a name of up to `40` characters.

Each entry of `checks` is `{ itemId, itemName, kind, key, name, at, note }`; `kind` is `site` or `direct`, and `key` is the site name or the free check URL. `seen` takes up to `200` entries and ignores any entry that is not an open bot check; `by` defaults to `Dashboard`. See [Bot checks](/reference/research-contract#bot-checks).

## New-item drafts

| Method | Path                              | Notes                                                                                                           |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/drafts`                     | open drafts                                                                                                     |
| `POST` | `/api/drafts`                     | body `{ input }`; queues the scope step; `202`                                                                  |
| `GET`  | `/api/drafts/:id`                 | the draft with its state, questions, config, events, and AI usage                                               |
| `POST` | `/api/drafts/:id/answers`         | body `{ answers }`; queues the research step; `202`                                                             |
| `PUT`  | `/api/drafts/:id/config`          | body `{ config, preset? }`; stores your edits                                                                   |
| `POST` | `/api/drafts/:id/schedules`       | body `{ preset }`; returns `{ schedules }` for a schedule preset                                                |
| `POST` | `/api/drafts/:id/change`          | body `{ instruction, config }`; queues an "Ask AI to change" step; `202`                                        |
| `POST` | `/api/drafts/:id/change/decision` | body `{ approve }`; keeps or discards the proposed change                                                       |
| `POST` | `/api/drafts/:id/test`            | body `{ config, kind? }`; runs the free direct check, or with `kind: "full"` queues one AI research run (`202`) |
| `POST` | `/api/drafts/:id/direct/test`     | body `{ entry }`; tests one product URL                                                                         |
| `POST` | `/api/drafts/:id/save`            | body `{ config? }`; creates the item; `201`                                                                     |
| `POST` | `/api/drafts/:id/cancel`          | stops the current step and cancels the draft                                                                    |
| `POST` | `/api/drafts/:id/retry`           | body `{ separate? }`; runs the failed step again                                                                |
| `POST` | `/api/drafts/:id/run-anyway`      | runs the waiting step once, past the usage guard; `202`                                                         |
| `GET`  | `/api/ai-usage`                   | scheduled AI runs per item against the monthly cap                                                              |

`input` holds these fields:

- `request`: required, `3–4000` characters
- `budget`: optional dollar amount
- `budgetMode`: `around` (default) or `limit`
- `needBy`: optional date after today
- `quantity`: `1–99`, default `1`
- `mustHaves`: up to `8`
- `links`: up to `5` public URLs

## Claude

| Method | Path                        | Notes                                                                                                                                               |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/claude/usage`         | the latest usage readings, the guard state, a `14`-day trend, and this month's AI runs                                                              |
| `POST` | `/api/claude/pause`         | sets Pause all AI; returns the usage view                                                                                                           |
| `POST` | `/api/claude/resume`        | clears Pause all AI; returns the usage view                                                                                                         |
| `POST` | `/api/claude/usage/refresh` | runs a one-turn `claude` call to read usage; at most once every `10` minutes; `429` when too soon, `409` when AI is busy, `502` when the call fails |
| `POST` | `/api/claude/test`          | runs a one-turn `claude` call to test the login; returns ok or the error                                                                            |

## Settings

| Method | Path                           | Notes                                                                                                                                                |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/settings`                | each setting with `key`, `label`, `secret`, `envName`, `isSet`, `source` (`settings`, `env`, `default`, or `null`), and `value` (masked for secrets) |
| `PUT`  | `/api/settings`                | body is an object of setting keys; a string sets an override, `null` deletes it; `400` lists every invalid key                                       |
| `POST` | `/api/settings/app-topic/test` | sends a test notice to the app topic; `{ delivered, sentAt, error? }`                                                                                |

See [Configuration](/reference/configuration#settings) for the keys and their rules.
