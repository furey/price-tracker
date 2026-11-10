---
title: Claude usage and the AI cap
icon: gauge
description: How AI research uses your Claude subscription, the reserves and the monthly cap that limit it, and how to pause, resume, or run anyway.
---

# Claude usage and the AI cap

AI research runs Claude Code on your Claude subscription. There is no bill per run. Each run uses part of your subscription's usage limits, the same limits your other Claude work uses. The app tracks your usage and stops AI checks before they eat into the usage you need.

## AI research runs

One AI research run is one check of one item. Claude searches the web and reads retailer pages for about 7 to 10 minutes, then reports the listings it found. The app then decides on alerts with plain code.

AI research runs:

- on the item's AI research schedule;
- when you press **Run now**, or **Test run** under **More**, on the item page;
- when you press **Run full test (1 AI check)** in the new-item wizard.

Only one AI job runs at a time. A scheduled run that falls due while another AI job runs waits for the next 15-minute tick. After a failed run, the app waits 2 hours before that item's next scheduled AI run.

The new-item wizard also runs Claude, for about 10 to 20 minutes per draft. Those steps use your usage but do not count toward the monthly cap.

## The Claude usage card

The **Claude usage** card sits at the top of the item list and in **Settings**, under **Claude and AI**.

![The Claude usage card, open](/screenshots/claude-usage-card.png)

The bar shows your weekly usage, with a mark at your reserve, and when the week resets. A label says **AI checks running**, or why AI checks are paused. Press the card to open it:

- **Five-hour session**: a second bar, when Claude reports a five-hour window.
- When and how the reading was taken, whether extra usage is on, and the AI runs this month against the cap.
- **Refresh**: asks Claude for a one-word reply to get a new reading. It uses a tiny amount of usage, and works once every 10 minutes.
- **Pause AI checks** or **Resume AI checks**.
- **How this works**: a short explanation.

> [!WARNING]<br>
> The figures cover your whole Claude account, work use included. They come from information Claude Code prints during a run, which is not a documented feature. A Claude Code update can change or remove them.

## The usage guard

Before each AI research run and each draft step, the app checks your latest usage readings. It skips the run when:

- you paused all AI;
- Claude reports that a usage limit is reached;
- your weekly usage is above the **Claude weekly reserve** (`70%` by default);
- your five-hour usage is above the **Claude five-hour reserve** (`90%` by default).

A skipped scheduled run shows as **Skipped** in **Recent runs**, with the reason. It is not a failure, and it does not count toward the monthly cap. That slot does not run again; the next slot runs as normal.

A scheduled run that starts below your reserve stops early if its first reading is above the reserve. It shows as skipped, with a reason such as "Stopped early: weekly usage 74% above 70% reserve". A run you start yourself never stops early.

When the guard starts to skip runs, the app sends one notice to the app topic: **AI checks paused**. When usage is back under your reserve, it sends **AI checks resumed**.

Free checks never pass through the guard. They keep running.

## The monthly AI cap

The **Monthly AI research cap** limits the AI research runs across all items in a calendar month, in your time zone (the **Time zone** setting). The default is `150` runs, about 5 a day. It counts runs, and has no dollar limit.

When this month's runs reach the cap:

- scheduled AI research stops until the 1st of next month;
- **Run now** and the wizard's full test are refused;
- the app sends one notice to the app topic: **Monthly AI cap reached**;
- the item list shows a banner.

Free checks continue. To resume now, raise the cap in **Settings**. Set the cap to `0` to stop all AI research.

The item list also warns you when your schedules would pass the cap before the month ends. A new item, or an edit that adds AI runs, is blocked when its next 30 days of runs would pass the cap.

## Pause and resume all AI

To stop all AI research, for example in a busy work week:

1. Open the **Claude usage** card.
2. Press **Pause AI checks**.
3. Press **Pause all AI checks** to confirm.

Scheduled AI research stops for every item. Free checks keep running, and their alerts still arrive. To start again, press **Resume AI checks**, then confirm. The same button is in **Settings**, under **Pause all AI**.

## Run anyway

When AI checks are paused or over your reserve, **Run now** shows the reason and a **Run anyway** button. **Run anyway** ignores the pause and the reserve for that one run. A waiting draft step offers **Run anyway** in the same way.

**Run anyway** does not get past the monthly cap.

## The Claude login token

The app runs Claude with a login token from your Claude subscription. With Docker, the container has no browser, so you make the token on another computer:

1. On a computer with a browser and Claude Code, run `claude setup-token`.
2. Sign in.
3. Copy the token it prints.
4. Paste it in **Settings**, under **Claude login token**, and press **Save**. You can put it in `.env` as `CLAUDE_CODE_OAUTH_TOKEN` instead.
5. Press **Test Claude login**.

**Test Claude login** runs one tiny Claude call and shows "Claude login works" or the error. When the token is wrong or expired, it tells you to run `claude setup-token` again. The page never shows the saved token.

On a Mac where `claude` is already signed in, you do not need a token.
