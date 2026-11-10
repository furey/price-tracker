---
title: Items
icon: list-checks
description: What an item holds, how the app decides a listing is a deal, and how to pause, archive, and delete an item.
---

# Items

An item is one thing you want to buy, such as a pressure washer or a trampoline. It tells the app what to look for, where to look, how often to look, and what price is worth an alert. The item list on the dashboard shows a card for each item.

![The item list](/screenshots/item-list.png)

Each card shows:

- the lowest price in the last 30 days, with a small trend line;
- the last run;
- the next AI check and the next free check;
- the last alert (test alerts do not count).

Press the item name to open [the item page](/guide/item-page).

## Parts of an item

- **Name**: the name in the list and in alert titles.
- **What the AI looks for**: a plain description of the exact product, and what to reject, such as other sizes, look-alikes, or parts sold alone.
- **Categories**: the models you accept, in order of preference. Each category has a short id, such as `premium-power-home`, and a description. The AI sorts each listing into one category, or into `reject`.
- **Alert prices**: the price rules for each category. See [Deal rules](#deal-rules).
- **Sources**: the retailer sites the AI checks by name, the search phrases it uses, and extra search phrases for sale periods.
- **Free checks**: product pages that the app reads with no AI. See [Free direct checks](/guide/direct-checks).
- **Schedules**: when AI research runs, and when free checks run. They are separate.
- **ntfy topic**: the topic that gets this item's alerts. See [Alerts and ntfy](/guide/alerts).
- **Tuning**: the models, products, sites, and phrases you muted. See [Tuning](/guide/tuning).

To change any of these, open the item and press **Edit**. See [Editing an item](/guide/editing).

## Deal rules

Each category has these price fields on the edit page:

- **Alert at or below**: the most you want to pay.
- **Clearance alert at or below**: an optional lower limit that applies only to clearance listings.
- **RRP**: the recommended retail price, if known.
- **Or this % below RRP**: a second way to qualify. A listing qualifies when its price is at least this far below the RRP.

A listing qualifies when the price after any promotion (the effective price) meets either rule. It must also be in stock, have a price, and have a web address.

When more than one listing qualifies, the app ranks them. Listings seen on the product page come first, then the category higher in your list, then the lower price. The alert names the first one that passes the repeat-alert check. See [Repeat alerts](/guide/alerts#repeat-alerts).

Some prices count only when you hold the membership. For `au`, a listing on `trade.bunnings.com.au` needs `Bunnings PowerPass`, and one on `costco.com.au` needs `Costco`. For `us`, a listing on `costco.com` needs `Costco`, and one on `samsclub.com` needs `Sam's Club`. Set your memberships in [Settings](/guide/settings#shopping).

An eBay listing counts only when all of these are true:

- The product is new.
- The seller is a business in the region (Australia for `au`, the United States for `us`).
- The listing states a warranty for that country, or the seller is the brand's official store or a known retailer.

## Versions

Every save makes a new version of the item, with a note that says what changed. Tuning changes make versions too. The edit page lists every version, and you can restore any of them. See [Restore a version](/guide/editing#restore-a-version).

Prices already recorded keep the rules of the version that recorded them. A new alert price does not judge old prices again.

## Pause and resume

A paused item runs no AI research and no free checks. Its history and settings stay, and pausing does not make a new version.

- **On the item list or the item page**: press **Pause**, then **Pause item**. Press **Resume**, then **Resume item**, to start again.
- **Until a date**: on the edit page, under **Manage**, pick a day in **Pause until a date** and press **Pause until then**. Checks start again at midnight on that day, in your time zone.

A paused item shows a **Paused** label. Scheduled checks start again from the next slot after you resume.

## Archive and delete

Archive an item when you have bought the product or no longer want it. All checks stop, the item leaves the main list, and its history stays.

1. Open the item and press **Edit**.
2. Go to **Manage**.
3. Under **Finish with this item**, press **Archive**.
4. Press **Archive item** to confirm.

To see archived items, press the **Archived** button at the bottom of the item list (it shows the count, such as **Archived (1)**). To bring one back, open it and press **Restore**.

Delete is only available for an archived item. It removes the item, every version, and all its runs, prices, and alerts. You cannot undo it.

1. Open the archived item and press **Edit**.
2. Go to **Manage**.
3. Press **Delete item and history**.
4. Type the item id to confirm.
5. Press **Delete item and history** again.

## Seed files

The `items` folder holds example items as JSON files. On startup, the app imports each file whose item is not in the database yet. After that, the database holds the item, and you change it in the dashboard. A deleted item does not import again from its file. The file format is in [Item config](/reference/item-config).
