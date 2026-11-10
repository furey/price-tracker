---
title: Deciding and alerting
description: How plain code turns a list of listings into at most one deal alert, and the limits that hold back AI runs.
icon: scale
---

# Deciding and alerting

<Diagram name="alert-decision" alt="A listing passes five checks in order: eligible, tuning, rules, trust, and dedupe. Passing all five sends a deal alert with an Open listing button. A listing that fails the trust check sends a check notice with no button. A tuned listing at or below its muted price sends a muted-price notice. Any other stop sends nothing." />

`decide` in `src/decide.js` is a pure function. It takes the item, the validated listings, and the last alerts, and it returns the decision. It never calls the model, the network, or the database.

## Before the decision

`src/runner.js` prepares the listings in this order:

1. **Retailer names.** A retailer name that matches a source name of the item takes that exact name. Every eBay listing gets the eBay retailer name of the region (`eBay AU` for `au`, `eBay` for `us` and `generic`), with `Sold by <seller> on eBay` in the notes.
2. **Memberships.** The region names hosts that need a membership. For `au`, a listing on `trade.bunnings.com.au` needs `Bunnings PowerPass`, and one on `costco.com.au` needs `Costco`. For `us`, a listing on `costco.com` needs `Costco`, and one on `samsclub.com` needs `Sam's Club`. Without that membership in Settings, the listing becomes a reject with the reason `Needs <membership> (not in your memberships)`.
3. **Tuning.** A listing that matches a `never` rule, or that is in a muted category, gets a `tuned` mark. It is still stored, but it never qualifies.

## Eligible listings

A listing is eligible when all of these are true:

- the category is not `reject`
- `inStock` is `true`
- it has a `url`
- `price` is a number
- it has no `tuned` mark

A missing `effectivePrice` takes the value of `price`. Each [kit](/reference/item-config#kits) that has a listing for every part becomes one more eligible listing, with retailer `Kit: <retailers>` and the summed price. A kit is verified only when every part is verified.

## Qualifying

A listing qualifies when its effective price passes any test of the rule for its category:

- **Price cap**: effective price at or below `maxPrice`. A clearance listing uses `maxPriceIfClearance` instead, when it is set.
- **RRP test**: effective price at or below `rrp × (1 − minPctBelowRrp / 100)`. A `null` `rrp` or `minPctBelowRrp` skips this test.
- **Per-unit test**: effective price divided by `unitCount` at or below `maxPricePerUnit`. A listing with no `unitCount`, or a rule with no `maxPricePerUnit`, skips this test. The reason reads, for example, `$0.46 per nappy, under $0.50`, with the name from `unit.name`.

The decision keeps the reasons as text, with prices in the currency and number format of the install, for example `under $1,100 cap` or `18% below RRP $1,999`. A category with no rule never qualifies.

## Ranking

Qualified listings sort by:

1. verified before unverified
2. category order in the item (the first category ranks highest)
3. lowest effective price

## Listing checks

Before a qualified listing can become a deal alert, these checks run on it:

- **Site**: the URL host must belong to a site of the item, a direct entry of the item, or the built-in list of known retailers in `src/retailers.js`. A listing that names a known retailer but sits on another host fails.
- **Price**: the effective price must not be below `40%` of `rrp`, or below `50%` of `maxPrice` when there is no `rrp`. A zero or missing price fails.

A listing that fails a check never sends a deal alert. The best one sends a "check this listing" notice instead, at priority `2`, with the host and the reasons. That notice has no "Open listing" button.

## Dedupe

Dedupe keys on the retailer (trimmed, lower case) and the category. A listing passes when its key has no earlier delivered deal alert. It also passes when its effective price is more than `dedupe.minDrop` below that alert's price. The best deal is the first ranked listing that passes. Each run sends at most one deal alert.

## Alert kinds

| Kind          | When                                                                                                                                               | Priority | Opens                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `deal`        | the best qualified listing passes dedupe                                                                                                           | `4`      | the alert page; an "Open listing" button goes to the retailer   |
| `check`       | a qualified listing failed a listing check                                                                                                         | `2`      | the alert page                                                  |
| `muted`       | a muted listing is at or below its `notifyBelow` price                                                                                             | `3`      | the alert page                                                  |
| `heartbeat`   | the first successful research run of the calendar month, when `heartbeat.monthly` is `true`                                                        | `2`      | the item page                                                   |
| `last-chance` | the first successful non-manual run on or after `deadline.needBy` less `deliveryDays` and `lastChanceDays`, and before `needBy`; once per deadline | `4`      | the alert page; an "Open listing" button for a trusted retailer |
| `test`        | `test-notify`, or "Send test notification" on the Settings page                                                                                    | `3`      | the Settings page                                               |

The `muted` and `check` kinds have their own dedupe history, so they never block a deal alert. Manual runs never send alerts. Dry runs show the messages without sending them.

A deal alert reads:

```text
Kärcher K7 deal found
Model: Kärcher K7 Premium Power Home
Price: $899 (was $1,099)
Retailer: Example Retailer
Notes: clearance; free delivery
```

The heartbeat names the lowest price seen, the number of qualifying listings, the sources that failed, and a summary of the muted models and sites.

## Delivery

The app stores the alert row first, so the link has an id. It then posts JSON to the ntfy server root:

- **Text**: em dashes and en dashes become `-`, and the app removes emoji. Non-ASCII letters such as `ä` stay.
- **Token**: the ntfy token goes in an `Authorization: Bearer` header, but only when the item's server has the same origin as `NTFY_TRUSTED_SERVER`.
- **Retries**: up to `3` retries, after `2`, `8`, and `30` seconds. HTTP `429` uses `Retry-After`, up to `60` seconds. Each request times out after `20` seconds.
- **Failure**: the alert row keeps `delivered = 0` and the error. On a Mac, a macOS notification reports the failure.

An undelivered deal alert does not count for dedupe, so the next run can alert again.

## Limits on AI runs

These limits apply to AI research runs only. Free direct checks skip them.

### Limits: monthly cap

The cap (`aiMonthlyCap`, default `150`) counts research runs that are not `skipped`, per calendar month in the time zone of the install. When the count reaches the cap:

- the tick skips research until the 1st of the next month
- "Run now" and the wizard's full test return `409`
- the app sends one notice per month to the app topic

The API blocks a save that adds scheduled runs when the next `30` days of runs for all items would pass the cap. Wizard steps (scope, research, change) do not count. The wizard's full test counts.

### Limits: Claude usage guard

Every `claude` run reports `rate_limit_event` lines. The app stores one row per usage window in the `claude_usage` table, and deletes rows older than `90` days. Before each research run and each draft step, the guard checks:

- **Pause all AI** is on: skip.
- A window's latest status is not `allowed`: skip until that window resets.
- Weekly usage is above the weekly reserve (default `70%`), or five-hour usage is above the five-hour reserve (default `90%`): skip until that window resets.

A reading whose reset time has passed does not count. A scheduled run that starts below the reserve stops early when its first reading is above it. The app stores it as `skipped`. Manual runs never stop early. The app sends one notice when the guard starts to skip, and one when AI runs resume.

### Limits: one AI job at a time

Every `claude` run holds `state/claude.lock`. A research slot that falls due while another AI job holds the lock moves to the next tick, with no failed run. "Run now" returns `409` while the lock is held.
