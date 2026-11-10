---
title: Troubleshooting
icon: life-buoy
description: Fixes for missing alerts, blocked sites, skipped AI checks, startup refusals, host errors, and seed warnings.
---

# Troubleshooting

Find the problem, then follow the fix. Most answers are on the item page, in **Recent runs** and **Recent alerts**, or in the app log.

## The log

- **Docker**: run `./logs.sh` in the app folder, or `docker logs price-tracker`.
- **Mac**: open `logs/tick.out.log` and `logs/tick.err.log` for the checks, and `logs/web.out.log` and `logs/web.err.log` for the dashboard.

## Missing alerts

Work down this list.

1. **Test the topic.** Open **Settings**, then **Test notifications**, and press **Send test notification** for the item. If the test does not arrive, the phone is not subscribed to that topic. Copy the topic again and subscribe. See [Subscribing](/guide/alerts#topics-subscribing).
2. **Check the delivery.** Open the item page, then **Recent alerts**. **Not delivered** means ntfy did not accept the alert, and the error shows under it. On a Mac, the app also shows a macOS notification when an alert is not delivered.
3. **Check for a repeat.** Open **Latest listings**. A note such as `suppressed: already alerted at $899, now $899` means the app already sent this deal. A repeat alert needs a lower price. See [Repeat alerts](/guide/alerts#repeat-alerts).
4. **Check for a "check this listing" notice.** A note with `check before buying` means the app sent a low-priority notice instead of a deal alert. The site is unknown, or the price looks too low. Your phone can deliver low-priority notices silently. See [Check this listing](/guide/alerts#alert-kinds-check-this-listing).
5. **Check for a mute.** A muted model or hidden product never sends a deal alert. Open **Suggestions and muted** to see what is muted.
6. **Check the run kind.** A **Test run**, a wizard test, and a recorded Chrome price never send alerts.

### Token withheld

If you use your own ntfy server with an access token, the app sends the token only to the trusted server. That is `https://ntfy.sh` unless you set `NTFY_TRUSTED_SERVER`. For any other server, the app sends the alert without the token, and a server that needs the token refuses it. The log shows:

```text
ntfy token withheld: https://ntfy.example.com is not the trusted ntfy server
```

Set `NTFY_TRUSTED_SERVER` in `.env` to your server's address, such as `https://ntfy.example.com`, then restart the app.

### Wrong alert link

Tapping an alert opens the **Dashboard URL** from Settings. If it opens the wrong address, or nothing, set **Dashboard URL** to an address your phone can reach, such as `http://nas.local:4280`. Alerts already sent keep the old address.

## Blocked sites

Some retailers block automated visitors. Open the item page, then **Sources**, and look at **Results by source**. A site with only blocked or error results on every check costs AI time and finds nothing.

- A site marked **Bot check** asked for a CAPTCHA or a bot check. Scheduled checks never solve one; the dashboard lists the site under **Sites asking for a human check** until you press **Got it**. See [Bot checks](/guide/chrome-observations#bot-checks).
- If a free check of the site also says **Blocked**, the site blocks plain requests too.
- To keep the prices, open the page in your own browser when you have time and record the price as a Chrome check. Large retailers, such as Home Depot and Amazon in the `us` region, often block the AI. See [Handle a bot check](/guide/chrome-observations#handle-a-bot-check).
- To save AI time, press **Mute site** or **Check weekly**. The app suggests this on its own after 3 checks. See [Tuning](/guide/tuning).

## Skipped AI checks

A skipped run shows as **Skipped** in **Recent runs**, with the reason. The **Claude usage** card shows the current state.

| Reason                                       | Fix                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Skipped: all AI paused by you`              | Press **Resume AI checks** on the **Claude usage** card.                                                                             |
| Weekly or five-hour usage above your reserve | Wait for the reset time on the card, or raise the reserve in Settings. To run one check now, press **Run now**, then **Run anyway**. |
| Claude usage limit reached                   | Wait for the reset time on the card.                                                                                                 |
| Monthly AI cap used up                       | Wait for the 1st of next month, or raise **Monthly AI research cap** in Settings.                                                    |

If AI runs fail instead of skip, open **Settings**, then **Claude login token**, and press **Test Claude login**. An expired token makes every AI check fail; make a new one with `claude setup-token`. After a failed run, the app waits 2 hours before it tries that item again on schedule.

**Run now** can also say `AI busy`, or that a run is already in progress. Only one AI job runs at a time; wait for it to finish.

## Startup refusals

The app checks its login settings at startup and stops with an error when they are unsafe.

| Error                                                                           | Fix                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SESSION_SECRET must be at least 32 characters`                                 | Make a longer secret with `openssl rand -hex 32`.                                           |
| `SESSION_SECRET is required when APP_PASSWORD is set`                           | Add a `SESSION_SECRET` to `.env`.                                                           |
| `Refusing to listen on 0.0.0.0 without APP_PASSWORD; set it or ALLOW_NO_AUTH=1` | Set `APP_PASSWORD` in `.env`. Set `ALLOW_NO_AUTH=1` only if nobody else can reach the port. |

The Docker container listens on every network address, so it always needs `APP_PASSWORD` or `ALLOW_NO_AUTH=1`. On a Mac, the app listens on `127.0.0.1` only and needs neither.

## Host not allowed

If the dashboard shows **Cannot load items** with `Host not allowed`, the address in your browser is not in `ALLOWED_HOSTS`. The app accepts `localhost` and `127.0.0.1` on its own, and any other address only when you list it.

1. Look at the address bar, for example `nas.local:4280`.
2. Add that host and port, exactly as you type them, to `ALLOWED_HOSTS` in `.env`. Separate several with commas: `nas.local:4280,nas.local:4280`.
3. Restart the app.

Include the port when the address has one. Leave it out only when the address has no port, for example behind a reverse proxy on port `80` or `443`.

## Copy topic on plain HTTP

Browsers allow the normal clipboard only on `https` pages and on `localhost`. On a plain `http` address, **Copy topic** uses an older copy method, and the button changes to **Copied**. If that also fails, the app selects the topic text instead. Copy it with your keyboard, or press and hold it on a phone.

## Seed file warnings

The log can show warnings about the files in the `items` folder at startup:

- `WARNING seed <file> changed in git, but item "<id>" was edited in the app. Kept the app version.` The file and the dashboard disagree, and the dashboard wins. To bring the file up to date, run `node src/cli.js export <id> > items/<id>.json`.
- `seed <file> skipped: ...` The file has a problem, which the message names. Fix the file, then restart.

A deleted item never imports again from its file, so a seed file can stay in the folder after you delete its item.
