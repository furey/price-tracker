---
title: Overview
icon: tag
description: Price Tracker tracks the products you want to buy, sends an alert to your phone when a price meets your rules, and keeps the price history.
---

# Overview

Price Tracker checks retailers for the products you want to buy. When a listing meets your price rules, it sends an alert to your phone through [ntfy](https://ntfy.sh). It keeps every price it finds, so you can see whether a deal is real before you buy.

You run it yourself, on a NAS (a network storage box) or home server with Docker, or on a Mac. You use it from a web page (the dashboard) and from the ntfy app on your phone.

![The item list, with the Claude usage card and a card for each item](/screenshots/item-list.png)

## What it does

- **Tracks products.** An item is one thing you want to buy. It lists the models you accept, in order of preference, and the price at which each model is worth an alert. See [Items](/guide/items).
- **Researches prices with AI.** On a schedule, Claude searches the web and reads retailer pages. It reports each listing with its price and the page text that shows the price. Then plain code checks each listing against your price rules.
- **Runs free checks.** For a product page you already know, the app reads the price from the page with no AI. These checks cost nothing, so they can run often. See [Free direct checks](/guide/direct-checks).
- **Sends alerts to your phone.** A deal alert names the model, the price, and the retailer, and opens the listing. See [Alerts and ntfy](/guide/alerts).
- **Keeps the price history.** Each item has a page with its lowest prices, the days a deal was live, a price chart, and the evidence for each price. See [The item page](/guide/item-page).
- **Drafts new items.** You describe what you want in plain words. Claude asks a few questions, researches the models and prices, and drafts the item for you to check. See [Creating an item](/guide/new-item).

## Limits

One install shops in one region and one currency. `REGION` in `.env` picks the region profile; see [Region](/reference/configuration#region).

- **Australia (`au`, the default)**: fully supported. Prices are in Australian dollars (AUD). AI research opens `.au` sites, `kogan.com`, `marketplace.qantas.com`, and the sites you list on an item. It knows the main Australian retailers, the OzBargain, eBay AU, and Amazon AU rules, and the Australian sale events. A free check keeps only AUD prices.
- **United States (`us`)**: supported. Prices are in US dollars (USD), before sales tax. AI research opens the sites you list on an item and these US sites: Amazon, Walmart, Target, Best Buy, Home Depot, Lowe's, Costco, B&H, Newegg, eBay, and Slickdeals. It opens no other `.com` site. It knows the Slickdeals, eBay, Amazon.com, and Walmart.com rules, and the US sale events. Delivery costs are to your ZIP code. Many large US retailers block Claude's page fetches, so a free check or a site you list is often the better source. See [Blocked sites](/guide/chrome-observations#blocked-sites).
- **Anywhere else (`generic`)**: works with your own currency, number format, and time zone, but knows no shops. AI research opens only the sites you list on an item, the app trusts only those sites, and no sale events are built in.

In every region, a site that research cannot open counts as blocked, and a free check keeps only prices in the currency of the install. The app has no exchange rates.

Scheduled checks never solve a CAPTCHA or a bot check. The app marks the site **Bot check** and lists it on the dashboard the next time you open it, so you can check that price in your own browser later. See [Bot checks](/guide/chrome-observations#bot-checks).

## Running costs

AI research runs on your Claude subscription through Claude Code. There is no API bill per run; each run uses part of your subscription's usage limits. One research run takes about 7 to 10 minutes of Claude time.

The app protects the usage you need for other work:

- AI checks stop when your weekly Claude usage passes a reserve (`70%` by default).
- AI checks stop when your five-hour usage passes a second reserve (`90%` by default).
- A monthly cap limits AI research runs across all items (`150` by default, about 5 a day).

Free checks and alerts use no Claude usage. See [Claude usage and the AI cap](/guide/claude-usage).

## Moving parts

- **The dashboard**: the web page the app serves, on port `4280` by default.
- **The check loop**: every 15 minutes, the app runs each item that is due, one at a time.
- **Claude Code**: Anthropic's command-line tool, `claude`. The app runs it to do the AI research, signed in to your Claude subscription.
- **ntfy**: the service and phone app that deliver the alerts. Each item has its own topic, and the app has one more topic for its own notices.
- **The database**: one file, `state/price-tracker.db`, that holds the items, prices, runs, and alerts. Back up this file to keep your history.

Next: [Getting started](/guide/getting-started).
