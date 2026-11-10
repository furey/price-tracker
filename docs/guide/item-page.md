---
title: The item page
icon: layout-dashboard
description: Everything on an item page, from the deal verdict and deal windows to the price chart, the latest listings, runs, alerts, and the evidence for each price.
---

# The item page

Press an item name on the item list to open its page. The top of the page answers "is there a deal now?". Below it, the page has four groups: **Prices**, **Details**, **Activity**, and **Settings and tuning**. **Prices** is always open. The other groups hold folded sections. Press a section title to open or close it; the page remembers which sections you opened.

![The top of an item page](/screenshots/item-page-top.png)

## Header buttons

- **Edit**: opens the [edit page](/guide/editing).
- **Run now**: runs one AI research check now. It saves the prices and sends any alert that qualifies.
- **More**: opens a menu with these:
  - **Test run**: runs one AI research check now, but saves no prices and sends no alerts.
  - **Pause**: stops this item's scheduled checks. See [Pause and resume](/guide/items#pause-and-resume).
  - The item id and its version number.

A paused item shows a banner with **Resume**. An archived item shows a banner with **Restore**.

Both runs ask you to confirm, and use about 7 to 10 minutes of Claude time. You cannot stop a run from the dashboard once it starts. When AI checks are paused or over your reserve, the page shows why and offers **Run anyway**. See [Claude usage and the AI cap](/guide/claude-usage).

## Summary

The top line answers **Is there a deal now?**

- **Deal now**: a deal window is live. The line names the category, the price, the retailer, and the day the deal started. Press **Open listing** to go to the retailer. The line has a green background.
- **Under target**: a price from the last 7 days is at or under its alert price, but no deal window is live yet.
- **No deal**: the best recent price in the category closest to its alert price, the alert price, and how far the price must still drop. For example: "No deal. Best base $1,769 at Temple & Webster, target $1,600. $169 to go".
- **No recent prices**: no listing was seen in the last 7 days.

The line uses each retailer's latest price from the last 7 days. It never uses a muted category. The target is the alert price, or the price under the RRP limit when that is higher.

Under the top line:

- **Last run**: the status of the last run, such as **OK**, **Failed**, or **Skipped**, and when it started.
- **Next checks**: the time of the next **AI** check and the next **Free** check. Under them, the AI research schedule in words, in your time zone, for example "AI schedule (Sydney time): Daily at 7:45 am".
- **Last alert**: when the last alert went out, and its kind. Test alerts do not count.
- **Needs attention**: blocked sources and bot checks, open tuning suggestions, and a failed last run. Each one links to the section that deals with it and opens it. **Nothing** means all is well.

Each part shows **Loading** until its data arrives.

## Prices

### Price history

The chart shows the lowest price per retailer per day for one category at a time. Press a category name to switch, and press **30 days**, **90 days**, or **365 days** to change the range. The marker shape shows how each price was found: **AI research**, **Free check**, **Chrome**, or **Kit**. The key lists only the kinds in the chart. A dashed line marks the alert price.

Press a retailer in the key to show only that retailer; the price scale then fits that retailer. Press it again, or press another retailer, to change the focus. A category or range change keeps the focus if that retailer is still in the chart. The table shows the focused retailer only.

Press a day on the chart to open its evidence. Press **Show as table** to see the same prices as a table. Tick **Show muted** to include muted prices, greyed.

### By category

One row per category, in your order of preference. Muted categories are left out. All prices are after promos.

- **Best now**: the cheapest latest price from the last 7 days, and the retailer.
- **Lowest ever**: the cheapest price recorded, with the retailer, the date, and how it was found. Press **See evidence** to open that day.
- **Target**: the alert price, or the price under the RRP limit when that is higher.

The row of the category in the **Is there a deal now?** line has a coloured background. On a phone, each row stacks.

### Deal windows

This part shows only when a deal window is live or ended in the last 30 days. A deal window is a run of days when one retailer's listing met your rules. **Live now** means the deal was still there on the last check. **Ended** means it went away, which is a missed deal. Each window says whether an alert was sent. It also names the kind of check that found the deal: **AI research**, **Free check** (see [Free direct checks](/guide/direct-checks)), or **Chrome** (a [price you recorded by hand](/guide/chrome-observations)).

Press **See evidence** to open the day's prices, or **Open listing** to go to the retailer.

## Details

- **Retailers**: one row per retailer, with the **Latest**, **Delivered**, **Lowest**, and **Highest** prices, **Last seen**, and a small **Trend** line.
- **Kit prices**: for an item with kits, the cheapest set of parts from each retailer, summed.
- **Price changes**: each time a retailer's price went **Down** or **Up**. Press **Evidence** to open that day.
- **Latest listings**: every listing from the latest successful run. See [Latest listings](#latest-listings).

## Activity

- **Recent alerts**: each alert sent, with **Delivered** or **Not delivered**. See [Recent alerts](#recent-alerts).
- **Recent runs**: each run with its start time, **Status**, **Trigger** (**Scheduled**, **Manual**, or **Test run**), listings found, listings that qualified, and cost.

## Settings and tuning

- **Suggestions and muted**: suggestions and everything you muted. See [Tuning](/guide/tuning).
- **Sources**: the **Results by source** table, then other sources from the last run and the search phrases. Each site has **Mute site** and **Check weekly** (or **Restore** and **Every run**) in its row. Each free check has **Turn off** or **Turn on**. Each search phrase has **Mute phrase** or **Restore**. A site or free check name links to the page that was checked, when the app knows it. When it does not know the page, a known retailer links to its home page and the link says "(home page)". A site whose latest check met a CAPTCHA or a bot check shows **Bot check** and the line "Open the page in your own browser when you have time, then record the price as a Chrome check." See [Results by source](/guide/tuning#results-by-source) and [Bot checks](/guide/chrome-observations#bot-checks).
- **Phone alerts**: the item's ntfy topic, with **Copy topic** and **Open in browser**. The topic shows only when the section is open.

## Section links

A link can open one section and scroll to it. Add the section name to the item address, for example `#/item/karcher-k7/runs`. The names are `listings`, `alerts`, `runs`, `retailers`, `kit`, `changes`, `tuning`, `sources`, and `phone`.

## Latest listings

![The Latest listings table](/screenshots/latest-listings.png)

Each row is one listing from the latest successful run, including the ones the AI rejected:

- **Retailer**: the retailer, the listing title, the notes, and the reason for a rejection.
- **Category**: the model the listing belongs to, or `reject`. A label shows **Muted model** or **Hidden product** for a muted listing. **Mute model** mutes the category from this row.
- **Price** and **After promos**: the listed price (with the was price), and the price after any promotion (with the delivery cost when known).
- **Verified**: **Verified** when the price was seen on the product page itself, otherwise **Unverified**.
- **Qualifies**: **Best deal** for the listing the alert named, **Qualifies** for another listing that met your rules, or **No**. The note under it gives the reason, such as `under $950 cap`.

Muted listings are hidden. Tick **Show muted** to see them greyed. Press a column title to sort.

## Recent alerts

Each alert shows its kind (**Deal**, **Check this**, **Muted price**, **Heartbeat**, or **Test**), the time, and whether ntfy accepted it. A deal has two links: **Why it alerted, and Not what I want**, and **Open listing**. A **Check this** notice has **Why it was held back** instead, and no listing link.

## Alert page

A deal alert on your phone opens the alert page. It shows the listing and the evidence text from the retailer's page. **Why it alerted** gives the rule and version that applied, the rank of the listing, and the check against the previous alert.

![The alert page for a deal](/screenshots/alert-page.png)

- **See every price that day** opens the day's evidence.
- **Open the run** shows the sources the run checked.
- **Not what I want** tunes the item from this alert. See [Not what I want](/guide/alerts#not-what-i-want).

## Day evidence

**See evidence**, **Evidence**, a day on the chart, and **See every price that day** all open a side panel for one day (in your time zone). It lists every price seen that day. Each price shows the retailer, the title, the category, the time, and how it was found. It also shows the price after promos, **Verified**, **Qualifies**, the promotion notes, the evidence text, and **Open listing**.

![The evidence panel for one day](/screenshots/day-drawer.png)
