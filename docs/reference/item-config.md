---
title: Item config
description: Every field of an item, the limits that validation applies, and how seed files, versions, and tuning fit together.
icon: file-json
---

# Item config

An item is one JSON object. The dashboard edits it, the wizard creates it, and a seed file in `items/` can start it. `validateItem` in `src/item-validate.js` checks the object on every seed import, every save, and every tuning change.

## Storage and versions

Items live in the `items` and `item_versions` tables. Each save makes a new version with a note and a source:

| Source   | Made by                                                          |
| -------- | ---------------------------------------------------------------- |
| `seed`   | the first import of a file in `items/`                           |
| `import` | a changed seed file for an item that was never edited in the app |
| `edit`   | a save on the edit page                                          |
| `wizard` | a save at the end of the new-item wizard                         |
| `tune`   | a tuning change                                                  |

At start, the app imports each seed file whose `id` is not in the database yet. After that, the database is the source of truth:

- **Changed seed file**: if nobody edited the item in the app, the file imports as a new version. Otherwise the app keeps its version and logs a `WARNING` that names the file.
- **Deleted item**: a tombstone row in `deleted_items` stops its seed file from importing again.
- **Copy back to git**: `node src/cli.js export <id> > items/<id>.json` writes the current config. A committed export matches the database, so the next start imports nothing.

A save must name the version it started from (`baseVersion`). If another save happened first, the API returns `409`.

## Fields

| Field             | Required                   | Rule                                                                                                                                                  |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | yes                        | non-empty; must equal the seed file name without `.json`; cannot change                                                                               |
| `name`            | yes                        | non-empty; used in alert titles                                                                                                                       |
| `enabled`         | no                         | read once, on the first import; `false` imports the item as paused                                                                                    |
| `product`         | yes                        | non-empty plain text; goes into the research prompt as written                                                                                        |
| `categories`      | yes                        | non-empty list of `{ id, description }`, in order of preference                                                                                       |
| `rules`           | yes                        | object keyed by category id; see [Rules](#rules)                                                                                                      |
| `schedules`       | yes                        | list of [schedules](#schedules) for AI research; an empty list turns research off                                                                     |
| `direct`          | no                         | list of [direct entries](#direct-entries)                                                                                                             |
| `directSchedules` | when `direct` is not empty | list of schedules for direct checks                                                                                                                   |
| `kits`            | no                         | list of [kits](#kits)                                                                                                                                 |
| `ntfy`            | yes                        | see [ntfy](#ntfy)                                                                                                                                     |
| `sources`         | yes                        | see [Sources](#sources)                                                                                                                               |
| `dedupe`          | no                         | `{ minDrop }`, a number of `0` or more; see [Dedupe](#dedupe)                                                                                         |
| `heartbeat`       | no                         | `{ monthly }`, `true` or `false`                                                                                                                      |
| `unit`            | no                         | `{ name }`, a short unit name such as `nappy`, up to `30` characters; the research then counts units per listing                                      |
| `accept`          | no                         | `{ refurbished }`, `true` or `false`; `true` needs a `refurbished` category; see [Research rules](/reference/research-contract#prompt-research-rules) |
| `deadline`        | no                         | `{ needBy, deliveryDays, lastChanceDays }`; see [Deadline](#deadline)                                                                                 |
| `research`        | no                         | see [Research options](#research-options)                                                                                                             |
| `tuning`          | no                         | see [Tuning](#tuning)                                                                                                                                 |

A category `id` uses lowercase letters, digits, and hyphens, and must be unique. `reject` is reserved.

## Rules

`rules` maps a category id to its price limits. Every key must be a category id.

| Field                 | Rule                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `maxPrice`            | positive number or `null`; the price cap in the install currency                      |
| `maxPriceIfClearance` | positive number or `null`; a lower cap for clearance listings                         |
| `rrp`                 | positive number or `null`; the recommended retail price in the install currency       |
| `minPctBelowRrp`      | number above `0` and below `100`, or `null`                                           |
| `maxPricePerUnit`     | positive number or `null`; a cap on the price per unit, used when the item has `unit` |

[Deciding and alerting](/reference/decisions#qualifying) shows how the code applies them.

Prices in an item are plain numbers in the currency of the install (`AUD` for `au`, `USD` for `us`). The app does not convert them when the Currency setting changes.

## Deadline

`deadline.needBy` is a `YYYY-MM-DD` date. `deliveryDays` (default `6`, `0` to `60`) and `lastChanceDays` (default `3`, `1` to `30`) are whole numbers. The first successful scheduled run on or after `needBy` less both numbers, and before `needBy`, sends one `last-chance` alert with the lowest in-stock price in the first category that is not muted, whatever its rule. The wizard writes `deadline` from **Need by**. `deadline` does not change the schedules; the wizard sets each schedule's `until` to `needBy` less `deliveryDays`.

## Dedupe

A repeat deal alert for the same retailer and category needs a price more than `dedupe.minDrop` below the last delivered deal alert. The amount is in the install currency. The app also reads the old name `dedupe.minDropAud`; the next saved version writes `minDrop`. When a config holds both, `minDrop` wins.

## Schedules

Each schedule is `{ cron, tz, from?, until? }`:

- `cron` and `tz` are required. `croner` must accept the pair. A new schedule made in the dashboard takes the Time zone setting.
- `from` and `until` are dates. A date-only value (`YYYY-MM-DD`) means local midnight in `tz`.
- `from` is inclusive and `until` is exclusive.

Several schedules can cover one item. For example, one schedule runs daily until a sale ends, and a second runs twice a week from that date.

```json
"schedules": [
  { "cron": "0 8 * * *", "tz": "Australia/Sydney", "until": "2026-12-02" },
  { "cron": "0 8 * * 1,4", "tz": "Australia/Sydney", "from": "2026-12-02" }
]
```

## Direct entries

Each entry is `{ retailer, url, category, parser, variantFilter?, part? }`:

| Field           | Rule                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `retailer`      | non-empty string                                                                                |
| `url`           | a public `http` or `https` URL, with no port and no user name                                   |
| `category`      | a category id; leave it out and set `part` for an accessory page                                |
| `part`          | a kit part id; the listings get category `accessory`                                            |
| `parser`        | `shopify` or `jsonld`                                                                           |
| `variantFilter` | plain words separated by `\|`; `^` and `$` only at the start or end of a word; no other symbols |

`variantFilter` is not a regular expression. A listing stays when its title contains one of the words, ignoring case.

## Kits

A kit prices a bundle from separate parts:

```json
"kits": [{
  "id": "sun-kit", "name": "Sun Bundle kit", "category": "sun-bundle",
  "parts": [
    { "id": "trampoline", "match": "base" },
    { "id": "sunshade", "name": "Sunshade", "description": "Medium Oval sunshade" }
  ]
}]
```

- `category` must be a category id. The assembled kit listing goes into this category.
- A part with `match` takes the cheapest eligible listing of that category.
- Any other part needs a `description`, and takes the cheapest eligible listing whose `part` equals the part id.
- Part ids must be unique within a kit.

## ntfy

`{ server, topic, tokenEnv? }`:

- `server` must be an `https` URL. `http` works only for `localhost`, `127.0.0.1`, and `[::1]`.
- `topic` uses letters, digits, `-`, and `_`, up to `64` characters. The app makes topics in the form `pt-<name>-<32 hex>`.
- `tokenEnv` names the environment variable that holds the token. It must match `NTFY_` followed by capitals, digits, or underscores.

## Sources

`{ sites, searches, seasonalSearches? }`:

- `sites`: a list of `{ name, url?, note? }`. `name` is required. `url` must be `http` or `https`.
- `searches`: a list of non-empty search phrases.
- `seasonalSearches`: a list of `{ phrase, from, until, note? }`. `from` and `until` are `YYYY-MM-DD`, and `until` must be after `from`. The phrase goes into the prompt only on days from `from` up to (not including) `until`.

## Research options

`{ maxTurns?, timeoutMinutes?, model? }`:

| Field            | Default             | Rule                               |
| ---------------- | ------------------- | ---------------------------------- |
| `maxTurns`       | `80`                | whole number, `1–500`              |
| `timeoutMinutes` | `15`                | number, above `0` and up to `120`  |
| `model`          | Claude Code default | a model name, for example `sonnet` |

## Tuning

`tuning` holds the changes made with the Tuning tools. Each entry carries `at` (ISO time), `by` (a name of `1–40` characters), and an optional `reason` (up to `200` characters).

| Section      | Keyed by                     | States                                        |
| ------------ | ---------------------------- | --------------------------------------------- |
| `categories` | category id                  | `muted`, with an optional `notifyBelow` price |
| `sites`      | site name in `sources.sites` | `muted` or `weekly`                           |
| `searches`   | search phrase                | `muted`                                       |
| `direct`     | direct entry URL             | `off`                                         |
| `never`      | a list, up to `50` rules     | see below                                     |

A `never` rule is `{ id, label, match, notifyBelow?, at, by, reason? }`. `match` holds at least one of `url`, `partNumber`, `titleWords` (`1–8` words), and `retailer`. At least one category must stay unmuted; pause the item instead.

## Example

```json
{
  "id": "karcher-k7",
  "name": "Kärcher K7",
  "enabled": true,
  "schedules": [{ "cron": "57 7 * * *", "tz": "Australia/Sydney" }],
  "direct": [
    { "retailer": "Example Tools", "url": "https://example-tools.com.au/k7", "category": "premium-power-home", "parser": "jsonld" }
  ],
  "directSchedules": [{ "cron": "30 7,19 * * *", "tz": "Australia/Sydney" }],
  "ntfy": { "server": "https://ntfy.sh", "topic": "pt-karcher-k7-<32 hex>", "tokenEnv": "NTFY_ACCESS_TOKEN" },
  "research": { "maxTurns": 80, "timeoutMinutes": 15 },
  "product": "A genuine Kärcher K7 pressure washer with an integrated hose reel. Reject the K7 Compact and accessories sold alone.",
  "categories": [
    { "id": "smart-control", "description": "K7 Smart Control, app-connected, integrated hose reel." },
    { "id": "premium-power-home", "description": "K7 Premium Power Home with integrated hose reel and Home kit." }
  ],
  "rules": {
    "smart-control": { "maxPrice": 1100, "rrp": null, "minPctBelowRrp": 15 },
    "premium-power-home": { "maxPrice": 950, "maxPriceIfClearance": 850, "rrp": null, "minPctBelowRrp": 15 }
  },
  "sources": {
    "sites": [{ "name": "Bunnings" }, { "name": "JB Hi-Fi" }, { "name": "OzBargain" }],
    "searches": ["Karcher K7 pressure washer"],
    "seasonalSearches": []
  },
  "dedupe": { "minDrop": 25 },
  "heartbeat": { "monthly": true }
}
```
