---
title: Database
description: The SQLite file, its tables, what each column holds, and some queries to read price history by hand.
icon: database
---

# Database

All state lives in one SQLite file, `state/price-tracker.db`. Set `DB_PATH` to use another file. The app opens it with the built-in `node:sqlite` module, in WAL mode, with foreign keys on and a `5000` ms busy timeout.

`openDb` in `src/db.js` creates any missing table and runs the migrations every time it opens the file. An older database upgrades in place. Booleans are `0` or `1`. Times are ISO 8601 strings in UTC.

> [!WARNING]<br>
> The `settings` table holds tokens saved on the Settings page as plain text. Protect `state/` the same way as `.env`.

## Tables

| Table           | Holds                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| `runs`          | one row per check (research, direct, or manual)                                  |
| `listings`      | every listing from every stored run, rejects included; this is the price history |
| `alerts`        | every alert the app tried to send                                                |
| `items`         | one row per item: status and current version                                     |
| `item_versions` | every saved config of every item                                                 |
| `deleted_items` | tombstones that stop a deleted seed from importing again                         |
| `drafts`        | new-item wizard drafts                                                           |
| `claude_usage`  | Claude usage readings, kept for `90` days                                        |
| `feedback`      | feedback on alerts and dismissed suggestions                                     |
| `settings`      | Settings page overrides and some app state                                       |

### Tables: runs

| Column                           | Values                                                |
| -------------------------------- | ----------------------------------------------------- |
| `trigger`                        | `tick`, `manual`, or `dry-run`                        |
| `mode`                           | `research`, `direct`, or `manual`                     |
| `status`                         | `running`, `ok`, `failed`, or `skipped`               |
| `slot_at`                        | the schedule slot the run covered, for a tick         |
| `error`                          | the failure or skip reason                            |
| `cost_usd`                       | the cost that Claude Code reports, at API list prices |
| `research_json`, `decision_json` | the full research reply and decision                  |
| `item_version`                   | the item version the run used                         |

A dry run stores only its run row. A run left `running` by a crash becomes `failed` with the error `interrupted` at the next tick.

### Tables: listings

Each row keeps `retailer`, `title`, `category`, `part`, `price`, `effective_price`, `was_price`, `delivery_cost`, `currency`, `is_clearance`, `in_stock`, `verified`, `url`, `qualifies`, `reject_reason`, `notes`, `evidence`, and `checked_at`. `source` is `research`, `direct`, `manual`, or `kit`. `tuned` holds `category:<id>` or `never:<rule id>` for a muted listing.

`currency` is the ISO 4217 code of the install when the row was written, for example `AUD` or `USD`. A later change to the Currency setting leaves old rows as they are.

### Tables: alerts

`kind` is `deal`, `heartbeat`, `test`, `muted`, `check`, or `last-chance`. A deal row keeps the listing's `effective_price` and its `currency`. `delivered` is `0` until ntfy accepts the alert, and `error` holds the last delivery error. Only delivered `deal` rows count for dedupe.

### Tables: items and versions

`items.status` is `active`, `paused`, or `archived`, with `paused_until` for a timed pause. `origin` is `seed` or `app`. `seed_hash` records the seed file content last imported. `item_versions` holds `config_json`, a `note`, and a `source` of `seed`, `edit`, `import`, `wizard`, or `tune`.

### Tables: drafts

`status` is one of `describing`, `scoping`, `clarifying`, `researching`, `review`, `testing`, `saved`, `failed`, or `cancelled`. Other columns hold:

- the input, the questions, and the answers
- the draft config and the research snapshot
- the Claude session id, the queued job, and its state
- the step events shown on the page, and the cost

### Tables: feedback

Each row has a `reason`, a `note`, the name in `by_name`, the `item_version`, and `changes_json`. Alert feedback uses `not-this-model`, `not-this-product`, `price-too-high`, or `not-now`. Suggestion rows use `suggestion-dismissed` or `suggestion-restored`. A **Got it** on the bot-check notice writes `bot-check-seen` with `changes_json` `{ kind, key, blockedAt }`; see [Bot checks](/reference/research-contract#bot-checks).

## Currency migration

Databases from before the region work used AUD-named price columns. On open, the app renames them in one transaction and adds `currency` with the default `AUD`, so every old row reads as AUD. The migration checks `PRAGMA table_info` first, so it runs once.

| Table      | Old column            | New column        |
| ---------- | --------------------- | ----------------- |
| `listings` | `price_aud`           | `price`           |
| `listings` | `effective_price_aud` | `effective_price` |
| `listings` | `was_price_aud`       | `was_price`       |
| `listings` | `delivery_aud`        | `delivery_cost`   |
| `alerts`   | `effective_price_aud` | `effective_price` |

Back up the database before the first start on the new version; see [Backups](#backups).

## Item name migration

Databases from before the item rename used watch-named tables and columns. On open, the app renames them in one transaction, before the currency migration. It checks `sqlite_master` and `PRAGMA table_info` first, so it runs once.

| Old name                                    | New name        |
| ------------------------------------------- | --------------- |
| `watches` table                             | `items`         |
| `watch_versions` table                      | `item_versions` |
| `deleted_watches` table                     | `deleted_items` |
| `watch_id` column (every table)             | `item_id`       |
| `watch_version` column (`runs`, `feedback`) | `item_version`  |

Stored JSON can still hold the old keys `watchId`, `watchName`, and `watchVersion`. The app reads them as `itemId`, `itemName`, and `itemVersion`.

## Queries

The lowest in-stock price per retailer per day:

```bash
sqlite3 state/price-tracker.db "
  select date(checked_at) as day, retailer, min(effective_price) as lowest
  from listings
  where item_id = 'karcher-k7' and in_stock = 1
  group by day, retailer
  order by day desc, lowest;"
```

`date(checked_at)` groups by UTC day. The dashboard and `node src/cli.js history` group by the item's time zone instead.

Undelivered alerts:

```bash
sqlite3 state/price-tracker.db "
  select sent_at, item_id, kind, title, error from alerts
  where delivered = 0 order by sent_at desc limit 20;"
```

## Backups

Stop the app before you copy the database. Copy `state/price-tracker.db` together with any `price-tracker.db-wal` and `price-tracker.db-shm` files beside it. With Docker, run `./stop.sh` first and `./start.sh` after.
