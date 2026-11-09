---
title: Reference
description: How Price Tracker works inside. Architecture, configuration, the item and research formats, the database, the HTTP API, the CLI, deployment, and security.
icon: book-open
---

# Reference

These pages describe how Price Tracker works inside. You do not need them to run it. Use them to understand a decision, to extend the code, or to debug something the [Guide](/guide/) does not cover.

## How it fits together

- [Architecture](/reference/architecture): the processes, the 15-minute tick, and the path of one check.
- [Configuration](/reference/configuration): every environment variable and setting, and which value wins.
- [Deployment](/reference/deployment): Docker on a NAS or server, or LaunchAgents on a Mac.

## Data formats

- [Item config](/reference/item-config): every field of an item, with its limits.
- [Research contract](/reference/research-contract): the prompt that Claude gets and the JSON it must return.
- [Deciding and alerting](/reference/decisions): the rules, the ranking, dedupe, and each kind of alert.
- [Database](/reference/database): the SQLite tables and what each one holds.

## Interfaces

- [HTTP API](/reference/http-api): every route under `/api`, with its body and its errors.
- [CLI](/reference/cli): every `node src/cli.js` command.

## Safety and work on the code

- [Security model](/reference/security): logins, request checks, limits on the AI, and limits on outbound fetches.
- [Development](/reference/development): run it locally, the tests, the build, and these docs.
