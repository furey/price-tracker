---
title: Tuning
icon: sliders-horizontal
description: Tell an item what you do not want, act on its suggestions, and see which sources earn their place, without deleting anything.
---

# Tuning

Tuning tells an item what you do not want: a model, an exact product, a site, a search phrase, or a free check. Nothing is deleted. Prices are still recorded; nothing muted ever alerts. Every tuning change saves a new version of the item, with who made it, when, and why.

Open an item page, then **Suggestions and muted** under **Settings and tuning**. It holds the suggestions and a list of everything you muted.

## Tuning actions

| You want to                 | Where                                                                                                               | What happens                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Stop alerts for a model     | **Not what I want**, then **Not this model** on an alert; **Mute model** on a listing; or **Mute** on the edit page | The model never alerts. The AI still sorts listings into it, so it does not mistake them for another model.   |
| Never see one product       | **Not what I want**, then **Not this exact product**                                                                | Listings that match its web address, part number, or title words never alert.                                 |
| Stop the AI visiting a site | **Mute site** in the **Sources** section                                                                            | The AI does not visit the site. A listing from it that another source finds can still alert.                  |
| Check a site less often     | **Check weekly** in the **Sources** section                                                                         | The AI visits the site only when no run reported it in the last 7 days, or while a seasonal search is active. |
| Stop a search phrase        | **Mute phrase** in the **Sources** section                                                                          | The AI does not search for the phrase.                                                                        |
| Stop a free check           | **Turn off** in the **Sources** section                                                                             | The free check skips that page.                                                                               |

The code applies muted models and hidden products to every listing before it decides on an alert. So even if the AI ignores an instruction, a muted model or hidden product cannot cause a deal alert.

## Review sheet

Every tuning change opens a review sheet first. Nothing saves until you confirm.

1. Check the change listed in the sheet.
2. Type why in **Note**.
3. Under **Changed by**, pick who is making the change. The browser remembers your choice.
4. Press the confirm button.

## Muted price alerts

A mute can still tell you about a very good price. When you choose **Not this model** on an alert, tick **Tell me if it drops below** and type a price. A listing of that model at or below the price sends one notice, at the default priority. It follows the same repeat rule as deal alerts. See [Muted price notices](/guide/alerts#alert-kinds-muted-price-notices).

## Muted prices on the page

The item card, the chart, the retailers table, and the latest listings hide muted prices. Tick **Show muted** on the chart, the retailers, or the listings to see them greyed.

## Restore

The **Suggestions and muted** section lists everything you muted, with who muted it, when, and why. Press **Restore** to undo a mute, or **Every run** to take a site off weekly checks. A restore saves a new version too.

Restoring an old version of the item keeps your current tuning, unless you tick **Also restore the tuning from version**. See [Restore a version](/guide/editing#restore-a-version).

## Suggestions

![Tuning, with a suggestion to review an alert price](/screenshots/tuning-suggestions.png)

The app looks at the last 30 days of checks and suggests changes with fixed rules. Each suggestion shows its evidence with the numbers. No suggestion applies itself.

| Suggestion             | When it shows                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mute a site            | The site gave no listing you could use in 30 days or in 90 days, the AI never read it, and any Chrome check found nothing.                                                                                            |
| Check a site weekly    | The AI was blocked or failed on every check but a Chrome check could read it; or a free check already covers it; or every listing it gave was rejected or muted; or the site rate-limited the AI on 2 or more checks. |
| Review an alert price  | The top model's lowest price stayed more than `10%` over its alert price for 5 sightings.                                                                                                                             |
| Mute a model           | You marked an alert **Not this model**, or **Just not now** on 2 alerts, without muting the model.                                                                                                                    |
| Keep or remove a model | A model had no listing in 10 AI runs.                                                                                                                                                                                 |
| Turn off a free check  | The free check failed on its last 3 runs.                                                                                                                                                                             |

For each suggestion:

- Press **Accept**, **Edit alert prices**, or **Edit models** to act on it. **Accept** opens the review sheet, so nothing saves until you confirm.
- Press **Dismiss** to hide it. Tick **Do not suggest this again** to keep it hidden.

### Suggestions: waiting for more checks

A site suggestion needs at least 3 AI checks of the site. Until then, the section says **Waiting for more checks**, with the number of checks each site still needs.

Deal and price-comparison sites, such as OzBargain, BuyWisely, and Slickdeals, never get site suggestions. A brand's own site, or a site with a usable listing in the last 90 days, is never suggested for muting.

### Suggestions: sale-window holds

Sales bring prices back to sites that were quiet. So the app holds site suggestions from 14 days before to 7 days after each sale event of your region:

| Region    | Sale events                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `au`      | Click Frenzy, Black Friday, Cyber Monday, Boxing Day, and the end of the financial year (EOFY)                                |
| `us`      | Presidents' Day, Memorial Day, Prime Day (an estimate: the second Tuesday of July), Labor Day, Black Friday, and Cyber Monday |
| `generic` | none                                                                                                                          |

It also holds them while a seasonal search on the item is active. The section lists the held suggestions and the date they return.

### Suggestions: dismissed

A dismissed suggestion comes back when its evidence doubles, when a new kind of evidence appears, or after 90 days. **Do not suggest this again** keeps it hidden. The section lists dismissed suggestions; press **Show again** to bring one back.

### Suggestions: all items

Sometimes the same site suggestion applies on every active item that lists the site. Then the card names the other items, and offers **Mute on all items** or **Weekly on all items**. One confirmation saves one new version per item.

The new-item research uses this too. It asks Claude to leave out sites that blocked or failed on every existing item, unless no other retailer stocks the product.

## Results by source

The **Sources** section opens with a table of each site, free check, and other retailer over **30 days** or **90 days**. Each site and free check row has its tuning buttons under the name.

![The Results by source table](/screenshots/results-by-source.png)

- **Checks**: the number of visits by AI research, or by the free check.
- **Results**: a bar of **OK**, blocked, error, and not-found results, with Chrome checks under it.
- **Found**: listings found.
- **Eligible**: found listings in stock, priced, not muted, and on the retailer's own site.
- **Qualify**: eligible listings that met your rules.
- **Alerts**: alerts sent.
- **Last useful**: the date of the last eligible listing.

A source name links to the page the latest check tried, or to the site's configured **URL**, and opens in a new tab. Press the arrow before a source name to see its last 10 results with their notes and the page each one tried. Use the table to find sites that cost checks but never help, then mute them or check them weekly.

The monthly heartbeat adds a line on your tuning, such as "Muted: 1 model, 2 sites. Checked weekly: 1 site".
