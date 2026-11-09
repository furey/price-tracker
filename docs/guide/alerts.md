---
title: Alerts and ntfy
icon: bell-ring
description: How alerts reach your phone through ntfy, each kind of alert and its priority, when a repeat alert is sent, and how to keep your topics private.
---

# Alerts and ntfy

Price Tracker sends its alerts through [ntfy](https://ntfy.sh), a notification service with a phone app. The app sends a message to a topic on an ntfy server, `https://ntfy.sh` by default. Every phone subscribed to that topic gets the message.

## Topics

A topic is a channel name, such as `pt-karcher-k7-0123456789abcdef0123456789abcdef`. Each item has its own topic, so you can mute one item on your phone without the others. The app has one more topic for its own notices, the app topic.

The app makes each topic from `pt-`, a short name, and 32 random characters, up to 64 characters in all.

### Topics: subscribing

1. Open the topic in the dashboard:
   - For an item: open the item page, then the **Phone alerts** section.
   - For the app topic: open **Settings**, **Phone alerts**, then **App ntfy topic**.
2. Press **Copy topic**.
3. In the ntfy app, tap **+**.
4. Paste the topic.
5. Keep the server as `ntfy.sh`, and subscribe.

**Open in browser** opens the topic's web address on the ntfy server.

![Settings, with the App ntfy topic open](/screenshots/settings-phone-alerts.png)

### Topics: testing

- **Send test** under **App ntfy topic** sends one test notice to the app topic. The result shows under the button.
- **Send test notification** under **Test notifications** sends one test message to an item's topic.

A test message opens the Settings page when you tap it.

## Alert kinds

| Alert              | When it is sent                                                                            | ntfy priority | Tap opens                                              |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------ |
| Deal found         | A listing meets your rules and passes the repeat-alert check                               | High (`4`)    | The alert page, plus an **Open listing** button        |
| Check this listing | A listing meets your rules, but its site is not known or its price is too low to be likely | Low (`2`)     | The alert page, with no **Open listing** button        |
| Muted price notice | A muted model or hidden product drops below the price you set                              | Default (`3`) | The alert page, plus **Open listing** for a known site |
| Still tracking     | Once a month, on the first AI research run of the month, when **Monthly heartbeat** is on  | Low (`2`)     | The item page                                          |
| Test               | You press a test button, or you save a new item                                            | Default (`3`) | The Settings page                                      |

The diagram shows how one listing becomes one of these alerts, or none. The rules are in [Deciding and alerting](/reference/decisions).

<Diagram name="alert-decision" alt="A listing passes five checks in order: eligible, tuning, rules, trust, and dedupe. Passing all five sends a deal alert with an Open listing button. A listing that fails the trust check sends a check notice with no button. A tuned listing at or below its muted price sends a muted-price notice. Any other stop sends nothing." />

The alert title starts with the item name. A deal alert lists the model, the price (with the was price), the retailer, and notes such as clearance, the promotion, or the delivery cost.

Free checks and AI research both send alerts. Prices you record by hand never send alerts. See [Chrome observations](/guide/chrome-observations).

### Alert kinds: deal alerts

A deal alert has two parts. Tap the alert to open the alert page in the dashboard, with the evidence and the reason it alerted. Press **Open listing** in the notification to go straight to the retailer. See [Alert page](/guide/item-page#alert-page).

The address that alerts open comes from the **Dashboard URL** setting. Your phone must be able to reach it. See [Settings](/guide/settings#phone-alerts).

### Alert kinds: check this listing

Sometimes a listing meets your rules but needs a second look before you buy. The app sends a "check this listing" notice instead of a deal alert when:

- the site is not a known retailer, and not one of the item's sites or free checks;
- the listing names a known retailer, but the web address is on a different site;
- the price is zero or missing;
- the price is too low to be likely: under `40%` of the RRP, or under `50%` of the alert price when there is no RRP.

The notice says why, and tells you to check the site is genuine. It has no **Open listing** button, so you open the alert page and check the site before you go there.

### Alert kinds: muted price notices

When you mute a model with **Not what I want**, you can tick **Tell me if it drops below** and set a price. A listing of that model at or below the price sends one notice. It follows the same repeat rule as deals. See [Tuning](/guide/tuning#muted-price-alerts).

### Alert kinds: monthly heartbeat

The heartbeat tells you the item still works when there is no deal. It gives the lowest price seen, the number of listings that qualified, any sources that failed, and a line on what you muted.

## App notices

The app topic gets notices about the app itself:

- A new-item draft needs your answers, is ready to review, or stopped.
- AI checks paused because your Claude usage passed your reserve, and later, AI checks resumed.
- The monthly AI research cap is used up.
- A test notice from **Send test**.

All app notices use the default priority (`3`). See [Claude usage and the AI cap](/guide/claude-usage).

## Repeat alerts

The app does not send the same deal twice. After a deal alert, the next deal alert for the same retailer and category needs a lower price. The drop from the last alerted price must be more than the **Repeat alert needs a drop of** amount on the edit page.

A listing that qualifies but is held back shows in **Latest listings**, with a note such as `suppressed: already alerted at $899, now $899`. Check notices and muted price notices follow the same rule, each counted on its own.

## Not what I want

**Not what I want** on the alert page tells the item what you do not want, without deleting anything. Choose one:

- **Not this model**: mutes the model. Its prices are still recorded, but it never alerts. Tick **Tell me if it drops below** to get a notice at a price you set.
- **Not this exact product**: hides this listing and keeps the model.
- **Price not low enough**: opens the alert price for the model on the edit page.
- **Just not now**: records the feedback and changes nothing.

Press **Review change**, check the change, then confirm it. A change saves a new version of the item. See [Tuning](/guide/tuning).

## Topics are secrets

On `ntfy.sh`, anyone who knows a topic can read its messages and send messages to it. The random part of a topic is what keeps it private. So:

- Do not share a topic, or put it in a screenshot or a public file.
- Never commit a real topic to git. The example items in the repository have placeholder topics.
- If a topic leaks, make a new one.

To make a new topic for one item, open its edit page and press **Generate new topic**, then save. To make new topics for every item and the app at once, run:

```bash
docker exec price-tracker node src/cli.js rotate-topics
```

On a Mac, run `node src/cli.js rotate-topics` in the project folder. Each item saves a new version with its new topic. Then subscribe to the new topics on your phone; the old topics stop getting alerts.

## Access tokens

An ntfy access token is optional. Set one in **Settings** under **ntfy access token**, or in `NTFY_ACCESS_TOKEN`. The app sends the token only to one trusted ntfy server: `https://ntfy.sh`, or the server in `NTFY_TRUSTED_SERVER`. For an item on any other server, the app sends alerts without the token.
