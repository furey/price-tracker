---
title: Getting started
icon: rocket
description: Install Price Tracker with Docker on a NAS or server, or run it on a Mac, then sign in, subscribe to alerts on your phone, and make your first item.
---

# Getting started

These steps install the app, set it up, connect your phone, and make your first item. There are two ways to run the app:

- **Docker**, on a NAS (a network storage box) or a home server that is always on. Docker runs the app in a container: a sealed package that holds the app and everything it needs.
- **A Mac**, on your own computer. While the Mac sleeps, no checks run. When it wakes, each item runs once for the latest check it missed.

## Requirements

- Optional: a Claude subscription, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on a computer with a web browser. Claude Code is the `claude` command that does the AI research. You use it once to make a login token, a long code that lets the app use your subscription. See [With or without Claude](#with-or-without-claude).
- The [ntfy app](https://ntfy.sh) on your phone. It shows the alerts.
- **For Docker**: a NAS or server with Docker, Docker Compose, and `git`.
- **For a Mac**: Node `22.5` or later, and Claude Code signed in, so that `claude` runs without a prompt.

## With or without Claude

The app works without Claude. You can add Claude at any time.

| Feature                                     | Without Claude | With Claude |
| ------------------------------------------- | -------------- | ----------- |
| Free checks of product pages                | Yes            | Yes         |
| Chrome checks                               | Yes            | Yes         |
| Price history, charts, and alerts           | Yes            | Yes         |
| Add an item by hand                         | Yes            | Yes         |
| AI research that finds prices at many shops | No             | Yes         |
| The new-item wizard that drafts items       | No             | Yes         |

Without Claude, the item list shows a **Connect Claude** card. Scheduled AI research is skipped, not failed, and item pages show **Waiting for Claude** for the next AI check. To connect Claude, add a login token in **Settings**. See [The Claude login token](/guide/claude-usage#the-claude-login-token).

## Install with Docker

The container runs the dashboard and the price checks together. Docker builds the container from the app's source code, so you download the code first with `git`.

1. Open a terminal on the NAS. Most NAS systems let you sign in from another computer over SSH, for example `ssh <user>@<nas-ip>`.
2. Download the code:

   ```bash
   git clone https://github.com/furey/price-tracker.git ~/services/price-tracker
   ```

3. Move into the folder:

   ```bash
   cd ~/services/price-tracker
   ```

4. Copy the example settings file. `.env` is a plain text file of settings, one `NAME=value` per line:

   ```bash
   cp .env.example .env
   ```

5. Fill in `.env`. The next section explains each value.
6. Build and start the app:

   ```bash
   ./start.sh
   ```

7. Open `http://nas.local:4280` in a browser.

`start.sh` builds the container, starts it, and then shows the app's log. Press `Ctrl+C` to stop the log; the app keeps running in the background. `<nas-ip>` is the NAS's address on your home network, such as the one your router shows for it. The script calls `docker-compose`. If your system has `docker compose` instead, run `mkdir -p state logs`, then `docker compose up -d --build`.

### The `.env` file

| Variable                  | What to put in it                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional. The Claude login token. On a computer with a browser, run `claude setup-token`, sign in, and copy the token it prints. You can also paste it on the Settings page later. |
| `APP_PASSWORD`            | The password for the dashboard. The container refuses to start without it, unless you set `ALLOW_NO_AUTH=1`.                                                                       |
| `SESSION_SECRET`          | A random string of at least 32 characters. The app uses it to sign the cookie that keeps your browser signed in. Make one with `openssl rand -hex 32`.                             |
| `ALLOWED_HOSTS`           | The addresses you type in the browser, with the port, separated by commas. For example: `nas.local:4280,192.168.1.50:4280`. The app refuses requests from any other address.       |
| `DASHBOARD_URL`           | The address that alerts open on your phone, for example `http://nas.local:4280`. The built-in default is `http://localhost:4280`, which your phone cannot reach, so set this.      |
| `REGION`                  | Optional. `au` (the default), `us`, or `generic`. It sets the currency, the time zone, and the shops that AI research trusts. See [Settings](/guide/settings).                     |
| `DELIVERY_POSTCODE`       | Optional. Your postcode, so research records the delivery cost to you: 4 digits for `au`, a 5-digit ZIP code (or ZIP+4) for `us`.                                                  |
| `DELIVERY_SUBURB`         | Optional. The suburb (for `us`, the city) for that postcode.                                                                                                                       |
| `NTFY_ACCESS_TOKEN`       | Optional. An ntfy access token, if your ntfy account uses one.                                                                                                                     |
| `HOST_PORT`               | Optional. The port on the NAS. The default is `4280`.                                                                                                                              |
| `PUID`, `PGID`            | Optional. The user and group the container runs as. The defaults are `1026` and `100`. This user must be able to write to the `state` and `logs` folders.                          |

The Settings page can change some of these values later. See [Settings](/guide/settings). The full list is in [Configuration](/reference/configuration).

> [!WARNING]<br>
> Do not put the dashboard on the internet without a password. With `ALLOW_NO_AUTH=1`, anyone who can reach the port can change your items and settings.

## Run on a Mac

On a Mac, two LaunchAgents run the app. A LaunchAgent is a background job that macOS starts for you. One runs the price checks every 15 minutes, and one keeps the dashboard running.

1. Download the code with `git clone https://github.com/furey/price-tracker.git`, and move into its folder.
2. Install the packages:

   ```bash
   npm install
   ```

3. Build the dashboard:

   ```bash
   npm run build
   ```

4. Optional: check that `claude` runs without asking you to sign in. Without it, the app runs without AI research.
5. Install and start the LaunchAgents:

   ```bash
   node src/cli.js install
   ```

6. Open `http://127.0.0.1:4280`.

On a Mac, the dashboard answers only on `127.0.0.1`, the address that means "this computer". Other devices cannot open it, so it needs no password. To stop the app, run `node src/cli.js uninstall`. Your history stays on disk.

## First sign-in

When `APP_PASSWORD` is set, the dashboard opens on a sign-in page. Type the password in **Password** and press **Sign in**. The browser stays signed in for 30 days. After 5 wrong passwords in 15 minutes, the app makes you wait before you can try again.

## Phone alerts

Alerts reach your phone through ntfy topics. A topic is like a channel name: the app sends a message to a topic, and your phone gets every message on the topics it subscribes to. Each item has its own topic, and the app has one more topic for its own notices, such as a draft that needs your answers.

The repository includes example items in the `items` folder, with placeholder topics. Give them random topics before you subscribe:

1. Make new random topics for every item and for the app:

   ```bash
   docker exec price-tracker node src/cli.js rotate-topics
   ```

   On a Mac, run `node src/cli.js rotate-topics` in the project folder.
2. Open **Settings**, then **Phone alerts**.
3. Open the **App ntfy topic** row.
4. Press **Copy topic**.
5. In the ntfy app, tap **+**, paste the topic, keep the server as `ntfy.sh`, and subscribe.
6. Press **Send test**, and check that the test notice arrives.
7. Open the **Test notifications** row. It lists each item with its topic.
8. Subscribe to each item topic in the same way.
9. Press **Send test notification** for each item.

![Settings, Phone alerts, with the App ntfy topic open](/screenshots/settings-phone-alerts.png)

> [!IMPORTANT]<br>
> On ntfy.sh, anyone who knows a topic can read its messages and send to it. Keep your topics private, and never commit a real topic to git. See [Topics are secrets](/guide/alerts#topics-are-secrets).

If you do not want the example items, archive them and then delete them. See [Archive and delete](/guide/items#archive-and-delete). A deleted item does not import again from its file.

## First item

Press **New item** at the top of the dashboard. Describe what you want to buy, answer a few questions, and check the draft before you save it. Saving sends a test alert to the new item's topic. See [Creating an item](/guide/new-item).

Without Claude, **New item** shows a short form instead. See [Add by hand](/guide/new-item#add-by-hand).

## Updating

With Docker, run `./update.sh` in the app folder. It downloads the latest code, rebuilds the container, and restarts the app. Your database, logs, and settings stay in the `state` and `logs` folders.

On a Mac, pull the latest code, then run `npm install`, `npm run build`, and `node src/cli.js install`.
