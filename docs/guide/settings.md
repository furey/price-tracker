---
title: Settings
icon: settings
description: Every row on the Settings page, what it does, and how a saved value overrides the value in .env.
---

# Settings

Open **Settings** at the top of the dashboard. The rows sit in groups: **Phone alerts**, **Claude and AI**, **Shopping**, **Region**, **Storage**, and **About**. Press a row to open it.

## Overrides and `.env`

Most rows start from a value in `.env` (an environment variable). Each row names its variable, and its summary says where the value comes from:

- **(from .env)**: the value comes from the variable.
- **(overridden here)**: you saved a value on this page. It wins over `.env`.
- **(default)**: neither is set, so the built-in default applies.

To override a value, type it in **New value** and press **Save**, then confirm the change. To go back to the `.env` value, press **Use .env value**, then **Clear override**. A saved value is stored in the app's database, not in git, and applies at once.

## Phone alerts

| Row                    | What it does                                                                                                                                                                                                    | Variable            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **ntfy access token**  | An optional token for your ntfy account. The page shows it masked, and never shows it again after you save. The app sends it only to the trusted ntfy server. See [Access tokens](/guide/alerts#access-tokens). | `NTFY_ACCESS_TOKEN` |
| **App ntfy topic**     | The topic for app notices: drafts, AI pauses, and the monthly cap. Shows **Copy topic**, **Open in browser**, and **Send test**. See [App notices](/guide/alerts#app-notices).                                  | `APP_NTFY_TOPIC`    |
| **Test notifications** | Lists each item with its topic, **Copy topic**, and **Send test notification**.                                                                                                                                 |                     |
| **Dashboard URL**      | The address that alerts open on your phone, such as `http://nas.local:4280`. It must start with `http://` or `https://`, and your phone must be able to reach it. Alerts already sent keep the old address.     | `DASHBOARD_URL`     |

![Settings, Phone alerts](/screenshots/settings-phone-alerts.png)

## Claude and AI

The group opens with the **Claude usage** card. See [Claude usage and the AI cap](/guide/claude-usage).

| Row                          | What it does                                                                                                                                                                                                                                   | Variable                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Claude login token**       | The token that runs Claude on your subscription. Make one with `claude setup-token`. **Test Claude login** checks that it works. Without a working token, AI checks wait for Claude; see [Without Claude](/guide/claude-usage#without-claude). | `CLAUDE_CODE_OAUTH_TOKEN`        |
| **Claude weekly reserve**    | AI checks stop when weekly Claude usage passes this percentage, and start again at the weekly reset. A whole number from `0` to `100`. The default is `70`.                                                                                    | `CLAUDE_RESERVE_PERCENT`         |
| **Claude five-hour reserve** | The same check for Claude's five-hour session window. The default is `90`.                                                                                                                                                                     | `CLAUDE_SESSION_RESERVE_PERCENT` |
| **Monthly AI research cap**  | The most AI research runs in a calendar month, across all items. A whole number from `0` to `1000`. The default is `150`; `0` stops all AI runs. The row shows this month's runs and the expected total.                                       | `AI_MONTHLY_CAP`                 |
| **Pause all AI**             | **Pause AI checks** stops AI research for every item. Free checks keep running.                                                                                                                                                                | `AI_PAUSED`                      |

## Shopping

| Row                   | What it does                                                                                                                                                                                                                                                                          | Variable            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Memberships**       | The memberships you hold. Member-only prices and coupons count only for memberships in this list. Type a name and press **Add**, or press a **Quick add** chip. Press a chip to remove it. **Use default** goes back to the region default: `eBay Plus` in Australia, none in the US. | `MEMBERSHIPS`       |
| **Delivery postcode** | Your postcode: `4` digits in Australia. In the US the row is **Delivery ZIP code** and takes a ZIP code such as `11201` or `11201-1234`. AI research records the delivery cost to it. The new-item wizard shows it as **Delivery to**.                                                | `DELIVERY_POSTCODE` |
| **Delivery suburb**   | The suburb for the postcode. In the US the row is **Delivery city**.                                                                                                                                                                                                                  | `DELIVERY_SUBURB`   |

The **Quick add** chips come from the region: Australian memberships such as Bunnings PowerPass and OnePass, or US ones such as Amazon Prime, Walmart+, and Costco.

## Region

The **Region** group sets how prices, numbers, and dates look, and the time zone. Each row starts from the region profile that `REGION` in `.env` picks: `au` (the default), `us`, or `generic`. See [Region](/reference/configuration#region) for what each profile does.

| Row                        | What it does                                                                                                                                                                                             | Variable    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Currency**               | The three-letter currency code that new prices are recorded and shown in, such as `AUD` or `USD`. Prices already recorded keep their old currency. Caps are not converted, so change your caps to match. | `CURRENCY`  |
| **Number and date format** | The locale for prices and dates, such as `en-AU` or `en-US`.                                                                                                                                             | `LOCALE`    |
| **Time zone**              | The time zone for "today", the day each price counts for, pauses, and new schedules, such as `America/Chicago`. Existing schedules keep their own time zone.                                             | `TIME_ZONE` |

Reload the dashboard after you save a Region row. `REGION` itself has no row; set it in `.env` and restart the app.

## Storage

| Row                             | What it does                                                                                                                                                                                                                                                   | Variable            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Screenshot storage cap (MB)** | The most space that screenshots of Chrome checks can use, in MB. A whole number from `10` to `5000`. The default is `200`. After an upload that passes the cap, the oldest screenshots are deleted. See [Screenshots](/guide/chrome-observations#screenshots). | `SCREENSHOT_CAP_MB` |

## About

- **Version**: the app version.
- **Database**: the database file the app uses.
- **This browser**: **Changed by**, the name this browser puts on tuning changes and feedback. It is kept in this browser only.
- **Help**: pointers to the project README.

## Settings outside the page

These values have no row on the page. Set them in `.env`: `APP_PASSWORD`, `SESSION_SECRET`, `ALLOWED_HOSTS`, `TRUST_PROXY`, `ALLOW_NO_AUTH`, `NTFY_TRUSTED_SERVER`, `HOST_PORT`, `PUID`, and `PGID`. See [Getting started](/guide/getting-started#the-env-file) and [Configuration](/reference/configuration).
