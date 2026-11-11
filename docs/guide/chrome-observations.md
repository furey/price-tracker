---
title: Chrome observations
icon: globe
description: Record prices you checked by hand in a browser, for sites that block both AI research and free checks.
---

# Chrome observations

Some retailers block both AI research and free checks. You can still check their prices yourself in a browser, such as Chrome, and add the prices to an item's history. The dashboard shows these prices as **Chrome**.

A recorded price goes through the same rules as any other price, so it can open a deal window and show as qualifying. It never sends an alert, and it does not change the item's schedules.

## When to use it

- The **Results by source** table shows a site as blocked on every AI check. See [Results by source](/guide/tuning#results-by-source).
- A free check of the site says **Blocked**.
- The dashboard lists the site under **Sites asking for a human check**. See [Bot checks](#bot-checks).
- You saw a price in a shop or in a browser and want it in the history.

Chrome checks also feed the tuning suggestions. When the AI cannot read a site but a Chrome check can, the app suggests weekly checks for the site.

## Blocked sites

Large retailers in any region can refuse the AI's page fetches. In a US dry run (`REGION=us`, a DeWalt drill), Home Depot, Lowe's, Amazon, Walmart, and Acme Tools refused with HTTP `403`, HTTP `503`, or a CAPTCHA page, and Slickdeals answered `403`. Research then had only search-result snippets. Every listing was unverified, so nothing could alert. Some Australian sites block too; see [Results by source](/guide/tuning#results-by-source).

### Bot checks

Scheduled checks run with nobody watching, so the app never solves a CAPTCHA or a bot check and never tries to get past one. When a site asks for one, the app records the check as blocked, marks the site **Bot check**, and moves on to the next site.

The next time you open the dashboard, a **Sites asking for a human check** notice sits above the item cards. It lists each site, its item, and the time of the bot check, with a link to that item's **Sources**. The site name links to the page the check tried, so you can open it yourself; a site with no known page has no link. **Got it** hides the notice. A new bot check from the same site after that shows the notice again.

The app sends no phone alert for a bot check. The monthly heartbeat lists the sites that asked for one in its run.

### Handle a bot check

Handle a bot check in your own time. These steps help, in order:

1. **Chrome check**: open the product page in your own browser, then record the price with the `record` command or the observations API. Claude in Chrome can read the page for you in your real browser session, or you can read it yourself. The run counts as a manual run and sends no alert. A Chrome check newer than the bot check clears the **Bot check** mark when it read the page (status `ok` or `not_found`). A Chrome check marked `blocked` or `error` leaves the mark.
2. **Free check**: if the shop is Shopify or publishes JSON-LD, add a free check of the exact product page. See [Free direct checks](/guide/direct-checks).
3. **Sources**: set a site that asks every time to **Check weekly**, or press **Mute site**, to save AI runs. A muted site shows no **Bot check** mark.

A Chrome check that reads a site the AI could not also triggers the tuning suggestion for weekly checks of that site.

## Chrome sweep

A Chrome sweep checks every blocked page in one go, with Claude in Chrome in your own browser. It lists each site and free check of an active item whose latest scheduled check in the last `30` days was blocked. A rate limit (HTTP `429`) does not count; the next scheduled check usually gets through. A muted site, a site set to off, and a site with a newer Chrome check that read the page (status `ok` or `not_found`) are not on the list. A Chrome check marked `blocked` or `error` keeps the site on the list. A free check comes off the list when a Chrome check records a listing at its page address.

The app never starts a sweep. You start it, and you stay at the browser while it runs. While blocked pages exist, a **Chrome sweep** card sits above the item cards.

1. Press **Copy prompt** on the **Chrome sweep** card, or run `node src/cli.js sweep` (`docker exec price-tracker node src/cli.js sweep` with Docker).
2. Paste the prompt into Claude in Chrome. The card says so: the dashboard sweep needs the Claude in Chrome browser extension.
3. Solve any CAPTCHA or bot check that Claude asks you to solve.
4. Copy Claude's whole reply.
5. Press **Record results** on the **Chrome sweep** card.
6. Paste the reply, then press **Record**.

The prompt tells Claude to read each page at a normal pace, to stop at a CAPTCHA and ask you, and never to try to get past a block. It gives the delivery suburb and postcode from **Settings** (or the item's own override). When a store asks where you are, Claude enters them, and picks the nearest store when the site needs one. Claude in Chrome cannot see or press Chrome's own pop-ups, such as a request for your location. When a page stalls or waits on a location, Claude asks you to answer the pop-up and waits for your reply. Claude also asks you before it marks a source blocked or error. Claude closes newsletter and cookie pop-ups and never signs you up. When a pop-up offers a discount for signing up, Claude notes the offer on that source and lists it in its report.

Claude ends its reply with one JSON block per item, each with an `itemId`. **Record** sends each block to `POST /api/items/<id>/observations` and shows what it recorded for each item, or what to fix. Each item becomes one Chrome check: it sends no alert, and it clears the **Bot check** mark. Without the dashboard, save a block (minus `itemId`) as a file and use the `record` command below.

## Screenshots

A Chrome check can keep screenshots of the pages it read. They show what the page said at the time.

Claude in Chrome cannot save files, so a sweep run from the side panel records prices only.

### Chrome sweep with Claude Code (optional)

To capture screenshots as well, let Claude Code run the sweep. It drives your own Chrome with the Claude in Chrome tools, saves a screenshot of each page, and records the prices and screenshots in the app. You need Claude Code and the Claude in Chrome extension on the computer with Chrome, and a clone of this repository. The app itself does not need any of it.

1. When the app runs somewhere else, such as Docker on a NAS, set `SWEEP_CLI` and `SWEEP_STATE` in `.env` in the clone. See `.env.example`. When the app runs from the clone, skip this step.
2. Open Claude Code in the clone and type "run the sweep". The `chrome-sweep` skill in `.claude/skills` does the rest.
3. Answer any CAPTCHA or Chrome pop-up that Claude asks about, or tell it to skip blocked sites.

The skill uses two commands that also work by hand:

- `node src/cli.js sweep --json` lists the blocked pages.
- `node src/cli.js record <id> <file.json> --screenshots <folder>` records one item's results with the images in the folder.

The `record` command takes PNG, JPEG, and WebP files from the folder, up to `2 MB` each and `20` per check. When a screenshot breaks a limit, the command records nothing and names the file.

To add screenshots by hand after a sweep from the side panel, press **Add screenshots** on the line of the item in **Record results**, and pick one or more images.

The browser shrinks each image to `1600` px wide and saves it as WebP (or JPEG when the browser cannot make WebP). Each line shows the progress of each image, and small previews of the saved images.

The screenshots show in **Recent runs** on the item page, and in the day view of the price chart. Press a preview to open the full image in a new tab.

Limits:

- Only Chrome checks take screenshots.
- Each image can be up to `2 MB`, in PNG, JPEG, or WebP.
- A Chrome check can have up to `20` screenshots.
- All screenshots together can use up to `200 MB`. Change this with **Screenshot storage cap** in **Settings**, or `SCREENSHOT_CAP_MB` in `.env`. After an upload that passes the cap, the app deletes the oldest screenshots until they fit.

The files are in `state/screenshots`. Deleting an item deletes its screenshots.

## Write the file

Write the prices in a JSON file with the same shape as an AI research result: the check time, the sources you checked, and the listings you found.

```json
{
  "checkedAt": "2026-11-08T10:05:00+11:00",
  "sources": [
    { "name": "Total Tools", "status": "ok", "note": "Checked in Chrome" }
  ],
  "listings": [
    {
      "retailer": "Total Tools",
      "title": "Karcher K7 Water Cooled Motor Pressure Washer 1.317-401.0",
      "category": "wcm-premium",
      "price": 899,
      "wasPrice": 1049,
      "effectivePrice": 899,
      "deliveryCost": null,
      "isClearance": false,
      "inStock": true,
      "verified": true,
      "url": "https://www.totaltools.com.au/example-product",
      "evidence": "Price $899 shown on the product page, Add to Cart available",
      "notes": "Checked in Chrome"
    }
  ]
}
```

- **`checkedAt`**: the date and time you checked.
- **`sources`**: each site you checked, with a `status` of `ok`, `blocked`, `error`, or `not_found`, and a short `note`.
- **`category`**: one of the item's category ids, or `reject`. The category ids are on the edit page, under **What to look for**.
- **`isClearance`**, **`inStock`**, and **`verified`**: `true` or `false`. These fields are required.
- **`price`**, **`wasPrice`**, **`effectivePrice`**, and **`deliveryCost`**: numbers in the region currency, or `null` when not known. The app still accepts the old names `priceAud`, `wasPriceAud`, `effectivePriceAud`, and `deliveryAud`.
- **`url`**: a public `http` or `https` address, or `null`.

The full field list is in [Research contract](/reference/research-contract).

## Record the file

With Docker:

1. Copy the file into the `state` folder of the app on the NAS.
2. Run the `record` command in the container, with the item id and the file:

   ```bash
   docker exec price-tracker node src/cli.js record karcher-k7 state/chrome-2026-11-08.json
   ```

On a Mac, run the command in the project folder:

```bash
node src/cli.js record karcher-k7 chrome-2026-11-08.json
```

The command checks the file, records the prices as a new run, and prints the decision: which listings qualify. If the file has a problem, the command names each field to fix and records nothing.

## From a script

`POST /api/items/<id>/observations` takes the same JSON and records it the same way. It needs a signed-in session and a same-origin JSON request, like the other changes the dashboard makes. It returns the `runId`. To add a screenshot, send the image to `POST /api/runs/<runId>/screenshots`. See [HTTP API](/reference/http-api#screenshots).
