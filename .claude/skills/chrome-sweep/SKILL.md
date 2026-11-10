---
name: chrome-sweep
description: Run the Price Tracker Chrome sweep from Claude Code. Opens every blocked retailer page in the user's own Chrome with the Claude in Chrome tools, reads the price, saves a screenshot of each page, and records the prices and screenshots in the app. Use when the user says "run the sweep", "chrome sweep", or asks to check blocked pages.
---

# Chrome sweep

This is an optional power-user tool. The app works without it; the dashboard's **Chrome sweep** card covers the same pages without screenshots. Run the whole sweep yourself; the user only answers CAPTCHAs and Chrome's own pop-ups.

## 0. Settings

Read these from `.env` in the project folder (never print other values from it):

- `SWEEP_CLI`: the command that runs the app's CLI. Default `node src/cli.js` (the app runs in this folder). For Docker on another machine, for example: `ssh nas 'docker exec price-tracker node src/cli.js'`.
- `SWEEP_STATE`: where to copy files so the CLI finds them under `state/`. Default `state` (a local folder). For Docker on another machine, an `scp` target of the host folder mounted at `/app/state`, for example `nas:services/price-tracker/state`.

`ssh` joins its arguments into one remote command, so `$SWEEP_CLI sweep --json` works with either form.

## 1. Get the pages

Run `$SWEEP_CLI sweep --json`. The reply is `{ items: [{ itemId, itemName, product, categories, delivery, sources: [{ kind, name, url, note }] }] }`. No items means nothing is blocked: say so and stop.

## 2. Check each page in Chrome

Load the Claude in Chrome tools in one ToolSearch call (tabs_context_mcp, tabs_create_mcp, navigate, computer, get_page_text, find, javascript_tool, tabs_close_mcp). If the extension is not connected, say so and stop. Create one new tab. For each source of each item:

1. Navigate to its `url` (no url: open the site and use its own search box). Wait 3 to 5 seconds, at a person's pace.
2. Close newsletter and cookie pop-ups. Never sign up or enter an email. Note any sign-up discount and its terms for the report and the source note.
3. When a store or postcode prompt shows, enter the item's `delivery` suburb and postcode; pick the nearest store when asked.
4. If the page stalls, shows nothing, or waits on a location, Chrome may be showing its own pop-up, which you cannot see. Ask the user to answer it and wait. If the user says to skip, mark the source `blocked`.
5. At a CAPTCHA, bot check, or sign-in page: ask the user to solve it. Never try to get past a block. If they do not, mark the source `blocked`.
6. Before you mark any source `blocked` or `error`, tell the user why and wait for their reply, unless they told you up front to skip blocks.
7. Read the price a shopper sees (get_page_text, or open the product page from search results). Never guess a price or stock level.
8. Take a screenshot with `save_to_disk: true` once the price is on screen. Keep the returned path.

Close the tab when done.

## 3. Build each item's results

Per item, make a folder `sweep-<timestamp>-<itemId>` in your scratchpad with `obs.json`:

```json
{ "checkedAt": "<ISO now>", "sources": [{ "name": "<source name>", "status": "ok", "note": "Checked in Chrome" }],
  "listings": [{ "retailer": "<source name>", "title": "<title>", "category": "<category id or reject>",
    "rejectReason": null, "price": 0, "wasPrice": null, "effectivePrice": 0, "deliveryCost": null,
    "isClearance": false, "inStock": true, "verified": true, "url": "<product page>",
    "evidence": "<price text seen>", "notes": "Checked in Chrome" }] }
```

`isClearance`, `inStock`, and `verified` are always `true` or `false`. A reject needs a `rejectReason`. Copy each screenshot into the folder as JPEG under 2 MB, at most 20 per item. On a Mac:

```bash
sips -s format jpeg -s formatOptions 80 -Z 1600 "<saved png>" --out "<folder>/<n>-<source>.jpg"
```

## 4. Record

For each item folder, copy it to `$SWEEP_STATE` (`cp -R` for a local folder, `scp -q -O -r` for a remote target). Then run `$SWEEP_CLI record <itemId> state/<folder>/obs.json --screenshots state/<folder>`, and delete the copied folder (its files, then the folder) from `$SWEEP_STATE`.

A validation error names the field; fix `obs.json` and record again. Nothing is recorded on a failed validation.

## 5. Report

One line per item: listings recorded, how many qualify, screenshots saved. Then any source left blocked, and every sign-up discount seen.
