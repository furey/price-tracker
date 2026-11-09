---
title: Development
description: Run Price Tracker locally, run the tests, build the dashboard, and work on these docs and diagrams.
icon: code
---

# Development

## Setup

```bash
npm install
npm run build
node src/cli.js serve
```

Node `22.5` or later is required; the code uses `node:sqlite`. The dashboard is then at `http://127.0.0.1:4280`. Runtime dependencies are `express` and `croner` only. The dashboard uses Vue 3 and Vite, with no router and no chart library.

## Dashboard with hot reload

1. Start the API: `node src/cli.js serve`.
2. In a second terminal, start Vite: `npm run dev:web`.
3. Open the address that Vite prints (port `5173`).

Vite serves `web/` and sends `/api` requests to `http://127.0.0.1:4280`. The server accepts state changes from the Vite origin on `localhost`.

## Tests

```bash
npm test
```

The tests use `node:test` and `node:assert/strict`, in `test/*.test.js`. They never reach the network or the real `claude`. `test/fake-claude.js` stands in for the `claude` process and replays a scripted output stream. Pure modules take an injected `now` and fake dependencies.

Do not set `DB_PATH` when you run the tests.

## Scripts

| Script                 | Does                                             |
| ---------------------- | ------------------------------------------------ |
| `npm test`             | runs the test suite                              |
| `npm run build`        | builds the dashboard into `web/dist`             |
| `npm run dev:web`      | starts the Vite dev server                       |
| `npm run serve`        | starts the dashboard server                      |
| `npm run diagrams`     | rebuilds the diagrams in `docs/public/diagrams/` |
| `npm run og`           | rebuilds the social sharing images               |
| `npm run docs:dev`     | starts the docs site with hot reload             |
| `npm run docs:build`   | builds the docs site into `docs/.vitepress/dist` |
| `npm run docs:preview` | serves the built docs site                       |

## Code style

- ECMAScript modules, plain JavaScript, no TypeScript.
- Small functions, arrow functions, `const`, and object parameters for three or more arguments.
- No semicolons, two-space indents, and lines of `100` characters at most.
- Exports at the top of a file, their helpers below, and small utilities at the bottom.
- No code comments; names carry the meaning.
- No em dashes, en dashes, or emoji in any text sent through ntfy or macOS notifications.

## Docs

The docs site is VitePress in `docs/`, with its own `package.json` and lock file. Install its dependencies once with `npm --prefix docs install`.

- **Pages**: `docs/guide/` for users and `docs/reference/` for the internals.
- **Config**: `docs/.vitepress/config.mjs` holds the navigation and sidebar.
- **Page icons**: a page's `icon` front matter adds an icon before its title. The file is `docs/public/icons/<name>-light.svg` and `-dark.svg`.
- **Diagrams**: `scripts/diagrams/build.mjs` draws each diagram as a light and a dark SVG. A page shows one with `<Diagram name="architecture" alt="..." />`.
- **Social images**: `npm run og` renders `docs/public/og.png` (`1200x630`, the link preview for the docs site) and `docs/public/social/github-social-preview.png` (`1280x640`, for the GitHub repository settings). It needs Docker; `scripts/generate-og.sh` runs `scripts/generate-og.mjs` with Playwright in a container. Run it again after you change the hero screenshot in `docs/public/hero/`.

The `Docs` workflow in `.github/workflows/docs.yml` builds the site on every push to `main` and every pull request that changes `docs/`. It deploys to GitHub Pages only when the repository is public.
