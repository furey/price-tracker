---
title: Research contract
description: The claude -p command, the prompt built from an item, the JSON that Claude must return, and the checks that run on it.
icon: bot
---

# Research contract

A research run asks Claude Code to collect facts and nothing more. `src/research.js` builds the prompt, runs `claude -p`, and reads the reply. `src/validate.js` checks the reply. The code then decides; see [Deciding and alerting](/reference/decisions).

## The command

```bash
claude -p "<prompt>" \
  --output-format stream-json --verbose \
  --tools WebSearch,WebFetch \
  --allowedTools "WebSearch,WebFetch(domain:*.au),WebFetch(domain:kogan.com),..." \
  --permission-mode dontAsk \
  --strict-mcp-config --restricted --disable-slash-commands \
  --settings '{"cleanupPeriodDays":14}' \
  --max-turns 80
```

- **Tools**: `WebSearch` and `WebFetch` only. No shell, no file access, and no MCP servers.
- **Fetch allowlist**: `WebFetch` may open the fixed domains of the [region](#prompt-regions) and the host of every site URL and direct URL in the item. For `au` the fixed domains are `*.au`, `kogan.com`, `*.kogan.com`, and `marketplace.qantas.com`. A denied fetch counts as blocked.
- **Options**: the app adds `--model` when the item sets `research.model`, and `--resume <session>` for a retry.
- **Process**: the binary is `CLAUDE_BIN` (default `claude`). It runs in `state/claude-work/` with its own process group and a [reduced environment](/reference/configuration#the-claude-child-environment).
- **Timeout**: after `research.timeoutMinutes` (default `15`), the app sends `SIGTERM` to the process group, then `SIGKILL` `10` seconds later.

The app reads the output stream line by line. It shows each search and page in the wizard, and it stores each `rate_limit_event` as a [usage reading](/reference/decisions#claude-usage-guard).

## The prompt

The app builds the prompt from the item in this order. A section with no content is left out.

| Section       | Content                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Intro         | Today's date in the time zone of the install. Claude collects facts; a separate program decides.                                           |
| `PRODUCT`     | The `product` text of the item, as written.                                                                                                |
| `CATEGORIES`  | Each active category id and description, `accessory` when the item has kits, and `reject`. Muted categories are listed as "do not target". |
| `NOT WANTED`  | The `never` rules from tuning, as products to report as rejects.                                                                           |
| `KITS`        | Each kit and its parts, and the rules for accessory listings.                                                                              |
| `RULES`       | The fixed research rules below.                                                                                                            |
| `OUTPUT`      | The JSON shape and the meaning of each field.                                                                                              |
| `DELIVERY`    | The delivery suburb and postcode (city and ZIP code for `us`), when set.                                                                   |
| `MEMBERSHIPS` | The memberships you hold, and how to apply member prices.                                                                                  |
| `SOURCES`     | Sites (minus muted ones and weekly ones not due), search phrases (minus muted ones), and the seasonal searches active today.               |

The prompt ends with: return the JSON in one final ` ```json ` block and write nothing after it.

### Prompt: research rules

These rules apply in every region:

- Search every source and every phrase. List every candidate, rejects included, with a `rejectReason`.
- Open each product page. `verified` is `true` only when Claude saw the price on that page in this run.
- A site that blocks Claude is `blocked`. Never try to get around a block.
- A site that shows a CAPTCHA or a bot check: never try to solve it, and write "CAPTCHA" or "bot check" in that source note.
- Never invent a price, a URL, or a stock state; use `null`.
- `effectivePrice` is the price after a verified gift card, cashback, or promo code. Member prices count only for memberships you hold.
- `retailer` is the exact source name. A marketplace seller goes into `notes`.

The region adds its market rules after the `verify` rule, and the rule numbers follow. The `au` rules:

- An OzBargain post under `7` days old and not marked expired can count, with `verified` set to `false`.
- Australian retailers only, selling in AUD with local stock and an Australian warranty.
- Reject Gumtree, Facebook Marketplace, used, refurbished, and open-box items, and third-party marketplace sellers.
- eBay AU: new condition, an Australian business seller, and an Australian warranty or an official brand or retailer store.
- Amazon.com.au: sold by Amazon AU or by the brand only.

The `us` rules:

- A Slickdeals post under `7` days old and not marked expired can count, with `verified` set to `false`.
- US retailers only, selling in USD, shipping within the United States, with a US warranty.
- US prices exclude sales tax. Claude records the listed price and never adds tax to `price`, `effectivePrice`, or `deliveryCost`.
- Reject Craigslist, Facebook Marketplace, used, renewed, refurbished, and open-box items, and third-party marketplace sellers.
- eBay: new condition, a US business seller, and a US warranty or an official brand or retailer store.
- Amazon.com: sold by Amazon.com or by the brand only. Walmart.com: sold by Walmart.com or by the brand only.

The `generic` rules accept only retailers that sell new in the install currency, and reject classified-ad sites, second-hand items, and marketplace sellers.

### Prompt: regions

`REGION` picks one profile for the whole install: `au` (the default), `us`, or `generic`. The profile sets the currency, the date in the intro, the market rules, the fetch allowlist, and the wording of the job and delivery lines. See [Configuration](/reference/configuration#region).

| Profile   | Fixed fetch domains                                                                                                                          | Deal forum |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `au`      | `*.au`, `kogan.com`, `*.kogan.com`, `marketplace.qantas.com`; a host on the item under `.au` adds nothing                                    | OzBargain  |
| `us`      | Amazon, Walmart, Target, Best Buy, Home Depot, Lowe's, Costco, B&H, Newegg, eBay, and Slickdeals, each as `host` and `*.host`; never `*.com` | Slickdeals |
| `generic` | none; only the hosts of the item's sites and direct entries                                                                                  | none       |

## The reply

```json
{
  "checkedAt": "2026-01-01T00:00:00+11:00",
  "sources": [{
    "name": "Example Retailer",
    "status": "ok",
    "note": "",
    "url": "https://example.com.au/search"
  }],
  "listings": [{
    "retailer": "Example Retailer",
    "title": "Product title",
    "category": "category-id",
    "part": null,
    "rejectReason": null,
    "price": 949,
    "wasPrice": 1099,
    "effectivePrice": 949,
    "deliveryCost": 0,
    "isClearance": false,
    "inStock": true,
    "verified": true,
    "url": "https://example.com/product",
    "evidence": "Text seen on the page",
    "notes": ""
  }]
}
```

| Field                                 | Type                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `checkedAt`                           | ISO 8601 string                                                   |
| `sources[].status`                    | `ok`, `blocked`, `error`, or `not_found`                          |
| `sources[].url`                       | optional; the page Claude opened or tried for that source         |
| `listings[].category`                 | a category id of the item, `accessory` (with `part`), or `reject` |
| `listings[].part`                     | a kit part id, or `null`                                          |
| `price`, `wasPrice`, `effectivePrice` | number above `0` and up to `200000`, or `null`                    |
| `deliveryCost`                        | number from `0` to `200000`, or `null`                            |
| `isClearance`, `inStock`, `verified`  | boolean                                                           |
| `url`                                 | a public `http` or `https` URL, or `null`                         |
| `retailer`, `title`                   | non-empty string                                                  |
| `rejectReason`, `evidence`, `notes`   | string or `null`                                                  |

A `sources[].url` that is not a public `http` or `https` address is dropped; the run still passes. A free check sets `url` to the product page of its entry. Runs stored before this field have no source `url`; the dashboard then links a site to its configured **URL**, if it has one, and otherwise shows no link.

## Bot checks

The app reads bot checks from the stored runs; nothing new is stored per run. A source result is a bot check when both of these hold:

- Its `status` is `blocked`.
- Its `note` matches one of these, ignoring case: `captcha`, `challenge`, "verify you are human", "are you a human" or "robot", the word `bot`, "access denied", `cloudflare`, `perimeterx`, `akamai`, `datadome`, `incapsula`, "pardon our interruption", "just a moment", or `403`.

A free check that gets a challenge page records `blocked` with the note "challenge page instead of product page" (or "product JSON"), and an HTTP `403` records `blocked` with the note `HTTP 403`, so both count. An HTTP `429` rate limit, a timeout, and an `error` result never count.

`isBotCheck` and `botCheckOf` in `src/bot-checks.js` hold the rule. For each site and free check of an active item, the app takes the latest check in the last `30` days. A Chrome check counts only when its status is `ok` or `not_found`; a Chrome check with `blocked` or `error` is skipped, so the earlier result stands:

| Latest check                                        | Result        |
| --------------------------------------------------- | ------------- |
| AI research or free check, a bot check              | **Bot check** |
| Anything else, or a Chrome check that read the page | No mark       |
| Any check, site muted or free check off             | No mark       |

**Got it** on the dashboard writes one `feedback` row per site, with `reason` `bot-check-seen` and `changes_json` `{ kind, key, blockedAt }`. The dashboard notice hides a site while a seen row matches its item, kind, key, and latest bot-check time. A newer bot check has a new time, so the notice shows again. The **Bot check** mark on the item page stays until a later check of the site gives another result. No phone alert is sent; the monthly heartbeat adds a line "Asked for a bot check" with the sites from its run.

## Validation

The app reads the last ` ```json ` block of the reply. If there is none, it tries the last fenced block, then the whole reply. `validateResearch` then checks every field type, every enum, and every category id. An error names its path, for example `listings[2].inStock: expected boolean`.

The validator also applies limits:

| Limit               | Value            |
| ------------------- | ---------------- |
| Listings kept       | first `200`      |
| Sources kept        | first `60`       |
| `retailer`          | `80` characters  |
| `title`             | `300` characters |
| `evidence`, `notes` | `500` characters |
| `rejectReason`      | `300` characters |
| Source `name`       | `120` characters |
| Source `note`       | `200` characters |

Longer text is cut and ends with `...`. A longer list keeps its first entries, with a warning.

All prices are numbers in the currency of the install. The `200000` limit is the `maxPrice` of the region profile.

## Contract versions

A valid reply is stored with `"contract": 2`. Version 2 uses the names `price`, `wasPrice`, `effectivePrice`, and `deliveryCost`. A stored run with no `contract` field is version 1, from before the rename; its prices are in AUD.

The app still accepts the version 1 keys `priceAud`, `wasPriceAud`, `effectivePriceAud`, and `deliveryAud`. It maps them to the new names before it validates, in a Claude reply, a manual observation, an API body, a stored run, and a saved draft. When a listing holds both names, the new name wins.

## Retry

When the first reply fails to parse or validate, the app sends a nudge: "Your last reply was not valid. Return ONLY the JSON object matching the schema, in one ```json block. Errors: ..." with up to `20` errors. The nudge resumes the same session. If the resume cannot start, the app runs the full prompt again with the nudge at the end. A second failure fails the run, and the [2-hour delay](/reference/architecture#one-tick) starts.

## Manual observations

`node src/cli.js record <id> <file.json>` and `POST /api/items/:id/observations` take a reply in the same shape. The app validates it, stores a run with mode `manual`, and marks the qualifying listings. A manual run never sends an alert.
