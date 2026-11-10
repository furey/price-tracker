---
title: Creating an item
icon: wand-sparkles
description: Describe what you want in plain words, and Claude drafts the item for you to check, test, and save.
---

# Creating an item

Press **New item** at the top of the dashboard. You describe what you want in plain words. Claude asks a few questions, researches the models and prices, and drafts the item. You check every value before it saves. The wizard is sized for a phone, so you can start a draft wherever you are.

![The first step of the new-item wizard](/screenshots/new-item-describe.png)

## Describe

Type what you want in **What do you want to track?**. Tap the microphone on your phone keyboard to talk instead of typing. Say who it is for, the size, the features you need, and your budget.

The other fields are optional:

- **Budget**, with **Around this** or **Hard limit**. A hard limit caps every alert price.
- **Need by**: the date you need the product. Checks stop 6 days before it, to allow for delivery, and 3 days before that the app sends one last-chance alert. See [Last chance](/guide/alerts#alert-kinds-last-chance).
- **How many**: the quantity.
- **Refurbished is OK**: adds a `refurbished` category with its own alert price, for units refurbished by the maker or a retailer, with a warranty. Used and open-box stock stays out.
- **Must-haves**: type a feature and press **Add**.
- **Links you already found (optional)**: product pages you found yourself. Press **+ Paste another link** for more.

**Delivery to** shows the postcode (ZIP code in the US) from Settings. If it says **Set a postcode** or **Set a ZIP code**, press it to set one.

Press **Start draft**.

## Clarify

Claude searches the web and builds up to 4 multiple-choice questions from the real models on sale. One answer can show **Recommended.** Every question also has a **Your answer** box for your own words. Press **Research these** when you finish. Claude can ask one more round of questions.

Claude can also stop the draft at this step:

- **Out of scope**: the request is a service, travel, or a product that no retailer in your region sells new. The region is Australia for `au`, the US for `us`, and your currency for `generic`. Press **Dismiss**.
- **Already tracking**: an existing item covers the same product. Open that item, or press **New item anyway**.

## Research

Claude researches:

- the models, in your order of preference;
- the look-alikes to reject;
- suggested alert prices, with the evidence;
- the RRP;
- the retailers and the search phrases.

This step takes up to 20 minutes.

The page shows each search and each page Claude opens. You can close it. Your phone gets a notice on the app topic when the draft needs your answers, and again when it is ready to review. See [App notices](/guide/alerts#app-notices).

## Review

The review screens show the draft. Change anything before you go on.

1. **Check the models**: the item name, the models in order of preference, and the look-alikes to reject.
2. **When should we alert you?**: the alert price for each model, with the RRP, the lowest price now, and the lowest price in the last year.
3. **Where to look**: the retailers, the search phrases, the sale searches, and the free price checks.
4. **How often to check**: choose **Light**, **Normal**, or **Keen**. The screen shows the AI checks in the next 30 days for this item and for all items, against the monthly cap.

To change the draft in plain words, press **Ask AI to change**. Type or say the change in **What should change?**, then press **Ask AI**. The sheet shows each changed field. Press **Use this change** to keep it, or **Discard**.

## Test

The free checks run on their own and show what would alert today. Nothing alerting is normal; prices often sit near the RRP before a sale.

Press **Run full test (1 AI check)** to run one AI research check against the draft. It takes about 7 to 10 minutes. Nothing goes into the history, and no alert is sent.

## Save

1. Press **Save item**.
2. Press **Save item** again to confirm.
3. Under **Get the alerts on your phone**, press **Copy topic**.
4. Subscribe to the topic in the ntfy app.
5. Check that the test alert arrived.
6. Press **Open the item**.

Saving makes the item active, starts its schedules, records today's prices as the first history point, and sends a test alert to the new topic.

## Drafts

Open drafts show at the top of the item list as cards with a dashed border. Each card shows the state, such as **Needs your answers** or **Ready to review**, and a button to go on. Press **Discard** to delete a draft.

A draft is kept in the database, so it survives a closed tab and a restart. Press **Save for later** on a review screen to leave and come back. The app deletes a draft that nobody touches for 14 days.

## Stops and retries

- **Stopped**: a step timed out or failed. Press **Retry**. Your answers are kept.
- **Usage limit**: Claude reported that your usage limit is reached. The draft shows the reset time when Claude gives one. Nothing retries on its own.
- **Waiting**: only one AI job runs at a time. A draft step waits while a research run uses Claude, and the page names the job it waits for.
- **AI paused or over your reserve**: the draft step waits until your usage is back under your reserve. Press **Run anyway** to run this draft step now.

## Draft costs

A draft uses about 10 to 20 minutes of Claude time, once. The draft steps use your Claude usage but do not count toward the monthly AI cap. The full test counts as one AI run.

The **How often to check** screen shows a dollar figure. It is what the same work would cost at API list prices, for comparison only; your Claude subscription pays. Save is blocked when the item's next 30 days of AI checks would pass the monthly cap. Pick a lighter schedule, pause another item, or raise the cap in Settings. See [Claude usage and the AI cap](/guide/claude-usage).
