---
title: Editing an item
icon: pencil
description: Change an item's alert prices, schedules, sources, and free checks on the edit page, review each change, and restore an earlier version.
---

# Editing an item

Open an item and press **Edit**. The edit page has one card per section, and a row of buttons at the top that jump to each section. Nothing changes until you save.

![The edit page, with the Basics and How often sections](/screenshots/edit-item.png)

## Saving changes

The bar at the bottom of the page counts your unsaved changes.

1. Press **Save changes**.
2. Check the list of changes. Each line shows the old value and the new value.
3. Type a note in **Note (optional)**, for example why you changed the price.
4. Press **Save version**, followed by the new version number.

The changes apply from the next check. Prices already recorded keep the rules they were judged by. Press **Discard** in the bottom bar to drop all unsaved changes.

If a field has a problem, a banner names the sections to fix, and the field shows the error. Save is blocked until you fix it.

## Basics

- **Name**: the name in the list and in alert titles.
- **ntfy topic**: the topic that gets this item's alerts. Press **Generate new topic** to make a new random one. After you save, phones subscribed to the old topic stop getting alerts, so subscribe to the new topic.
- **ntfy server**: the ntfy server, `https://ntfy.sh` by default.

## How often

There are two schedules: **AI research** and **Free checks**. Each one has **On** and **Off**.

For each schedule, pick a **Repeat** pattern:

- **Daily**, at one **Time**.
- **Twice daily**, at a **First time** and a **Second time**.
- **Weekdays**.
- **On chosen days**, with **Days of the week**.
- **Custom cron**, with a **Cron pattern** (minute, hour, day of month, month, weekday, in your time zone).

**Start date** and **Stop date** are optional. A blank start date starts now. Checks stop at the start of the stop date; a blank stop date never stops.

Press **Add a schedule** to change the pace on a date. For example, check daily until a sale ends, then twice a week. Under each schedule, **Next 3 checks** and **Next 30 days** show what your settings do.

With **AI research** off, no AI research runs on a schedule, but **Run now** still works.

## Alert prices

The categories are in order of preference. When two deals qualify, the alert names the one higher in the list. Press **Up** or **Down** to change the order.

Each category shows the lowest price seen in the last 90 days, to help you set a realistic price. Then set:

- **Alert at or below**: the most you want to pay.
- **Clearance alert at or below**: an optional lower price for clearance listings.
- **RRP**: the recommended retail price.
- **Or this % below RRP**: a listing also qualifies when it is this far below the RRP.

Two more fields apply to the whole item:

- **Repeat alert needs a drop of**: a second alert for the same retailer and category needs at least this much off the last alerted price. See [Repeat alerts](/guide/alerts#repeat-alerts).
- **Monthly heartbeat**: sends a "still tracking" message once a month with the lowest price.
- **Need by**, **Days to allow for delivery**, and **Last-chance alert, days before that**: set when the one last-chance alert goes. Clear **Need by** for no deadline. The schedules still set when checks stop. See [Last chance](/guide/alerts#alert-kinds-last-chance).

## What to look for

**What the AI looks for** describes the exact product, and what to reject, such as other sizes, look-alikes, or parts sold alone. Write it plainly; the AI reads it on every check.

Under **Categories**, each category has an **Id** and a **Description**. Press **Mute** to stop a category from alerting, or **Remove category** to delete it. Type a **New category id** and **Description**, then press **Add category**.

## Where to look

- **Sites**: the retailers the AI checks by name. A **URL** and a **Note** are optional. Press **Add site** for more.
- **Search phrases**: the phrases the AI searches for. Press **Add search phrase** for more.
- **Seasonal searches**: extra phrases used only between a **From** date and an **Until** date, for example a Black Friday search. Press **Add seasonal search**.

## Free checks

Free checks read one product page with no AI. See [Free direct checks](/guide/direct-checks).

For each free check, set:

- **Retailer**: the retailer name.
- **Counts as**: the category the product belongs to.
- **Product URL**: the web address of the product page.
- **Read with**: **Shopify product JSON** or **Page JSON-LD**.
- **Variant filter**: optional. See [Variant filters](#variant-filters).

Press **Test** to read the page once and see the result before you save. The result links to the page it read. Press **Add free check** for more, or **Remove free check** to delete one.

### Variant filters

One product page can list several variants, such as sizes or colours. A variant filter keeps only the variants whose title matches. Use plain words; separate choices with `|`.

| Filter                    | Keeps a variant when its title         |
| ------------------------- | -------------------------------------- |
| `medium oval`             | contains "medium oval"                 |
| `medium oval\|large oval` | contains "medium oval" or "large oval" |
| `^sun`                    | starts with "sun"                      |
| `bundle$`                 | ends with "bundle"                     |

Case does not matter. You can use `^` only at the start of a choice and `$` only at the end. Other symbols, such as `.`, `*`, `+`, `?`, and brackets, are not allowed.

## Advanced

- **Max turns**: how many search and page steps one AI run can take. Blank uses `80`.
- **Timeout in minutes**: the run stops after this long. Blank uses `15`.
- **Model**: the Claude model. Blank uses the Claude Code default model.

A lower turn limit or a smaller model uses less of your Claude usage.

## Restore a version

The **Versions** section lists every version, with the date it was saved, where it came from (**Dashboard**, **Tuning**, **New item**, or **Repo file**), and its note.

1. Press **View** to see a version's settings.
2. Press **Restore this version**.
3. Press **Save as version**, followed by the new version number.

Restoring saves the old settings as a new version, so nothing is lost. Your current tuning (muted models, sites, and hidden products) stays, unless you tick **Also restore the tuning from version**.

## Manage

**Manage** holds **Pause now**, **Pause until a date**, **Archive**, and, for an archived item, **Restore** and **Delete item and history**. See [Pause and resume](/guide/items#pause-and-resume) and [Archive and delete](/guide/items#archive-and-delete).
