---
title: Free direct checks
icon: zap
description: Free checks read the price from a product page you already know, with no AI, on their own schedule.
---

# Free direct checks

A free check reads the price from a product page you already know. It uses no AI and no Claude usage, so it can run as often as you like. In the dashboard, prices from free checks show as **Curl**.

A free check finds nothing new; it only reads the pages you give it. AI research finds new retailers and new listings. Use both: AI research a few times a week, and free checks once or twice a day on the pages that matter.

## How they work

Each free check has a product URL and a reader:

- **Shopify product JSON**: for a shop built on Shopify. The app reads the product data that Shopify publishes at the page address plus `.json`. Each variant, such as a size or colour, becomes one listing. The compare-at price becomes the was price. Shopify product JSON names no currency; see [Currency checks](#currency-checks).
- **Page JSON-LD**: for most other shops. The app reads the product data that the page includes for search engines (`application/ld+json` blocks) and takes the product offers. The offer's `priceCurrency` must be the region currency (`AUD` for `au`, `USD` for `us`), and only an "in stock" availability counts as in stock.

### Currency checks

A free check keeps only prices in the region currency. Page JSON-LD names its currency, so the app compares it with the region currency. Shopify product JSON names no currency, so the app accepts a Shopify price only from these sites:

- **`au`**: a site on a `.au` address.
- **`us` and `generic`**: a site listed on the item, under its sites or its free checks. You listed the site, so the app takes its prices as the region currency.

In the new-item wizard, for `us` and `generic`, a Shopify price counts only from a site in a link you typed. A Shopify page the AI found falls back to Page JSON-LD.

A free check result goes through the same rules, repeat check, alerts, and history as an AI research run.

A free check result has one of these statuses:

- **OK**: the page gave a price.
- **Blocked**: the site answered with HTTP `403` or `429`, or a bot-check page. The app does not try that page again in the same run. An HTTP `403` or a bot-check page also marks the free check **Bot check**; see [Bot checks](/guide/chrome-observations#bot-checks).
- **Error**: anything else, such as a page with no product data.
- **Not found**: the Shopify shop has no product with that address.

## Limits

Free checks cannot read a price that the page builds with JavaScript after it loads. They also cannot get past bot protection. For those retailers, rely on AI research, or record the price by hand. See [Chrome observations](/guide/chrome-observations).

## Schedule

Free checks run on their own schedule, separate from AI research. Set it under **How often**, then **Free checks**, on the edit page. They keep running when AI checks are paused, over your reserve, or over the monthly cap. They stop when you pause or archive the item.

The app waits between requests to the same site, so a list of pages on one shop does not flood it.

## Allowed addresses

The app fetches only public web pages. A product URL must:

- start with `http://` or `https://`;
- use the standard web port (no `:8080` or other port in the address);
- have no user name or password in it;
- point to a public site. A private network address, such as `192.168.x.x`, `localhost`, or a `.local` or `.lan` name, fails.

The app checks the address again after it looks up the site, and again for every redirect. A redirect to a private address fails.

## Add and test a free check

1. Open the item and press **Edit**.
2. Go to **Free checks**.
3. Press **Add free check**.
4. Type the **Retailer** name.
5. In **Counts as**, pick the category of the product.
6. Paste the **Product URL**.
7. In **Read with**, pick **Shopify product JSON** or **Page JSON-LD**.
8. Press **Test**.
9. Check the result: a status and the listings found, with price and stock.
10. Press **Save changes**, then save the version.

If the test says **error** with Page JSON-LD, try Shopify product JSON, or use AI research for that retailer. If one page lists several variants, add a [variant filter](/guide/editing#variant-filters).

The new-item wizard tests the product links it finds the same way. Only links that return a price in the region currency become free checks.

## Turn a free check off

To stop a free check without deleting it, open the item page, then **Sources**, and press **Turn off** beside it. The app also suggests this when a free check fails on its last 3 runs. See [Tuning](/guide/tuning).
