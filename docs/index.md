---
layout: home

hero:
  name: Price Tracker
  text: Tell it what you want to buy. Get notified when the price is right.
  tagline: >-
    Describe the product in plain words. It searches sites on a schedule, checks your rules in
    plain code, and pings your phone when a listing meets them.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Overview
      link: /guide/
    - theme: alt
      text: Reference
      link: /reference/

features:
  - icon:
      light: /icons/tag-light.svg
      dark: /icons/tag-dark.svg
    title: Items with price rules
    details: Each item names a product, the models you accept in order of preference, a price cap per model, and the sites to check. Every edit saves a new version.
    link: /guide/items
    linkText: About items
  - icon:
      light: /icons/sparkles-light.svg
      dark: /icons/sparkles-dark.svg
    title: AI research, plain-code decisions
    details: Claude Code searches the web and reports every listing it finds as JSON. Node code then applies your rules, so the AI never decides whether to alert.
    link: /reference/research-contract
    linkText: The research contract
  - icon:
      light: /icons/zap-light.svg
      dark: /icons/zap-dark.svg
    title: Free direct checks
    details: Known product pages get a plain fetch on their own schedule. Shopify and JSON-LD pages give a price with no AI and no cost.
    link: /guide/direct-checks
    linkText: About direct checks
  - icon:
      light: /icons/bell-ring-light.svg
      dark: /icons/bell-ring-dark.svg
    title: Alerts through ntfy
    details: One deal alert per run, with a link to the evidence on the dashboard. A repeat alert for the same retailer and model needs a lower price.
    link: /guide/alerts
    linkText: About alerts
  - icon:
      light: /icons/sliders-horizontal-light.svg
      dark: /icons/sliders-horizontal-dark.svg
    title: Tuning from evidence
    details: Mute a model, a site, or one exact product without deleting it. Suggestions come from the results of your recent checks, and you accept or dismiss each one.
    link: /guide/tuning
    linkText: About tuning
  - icon:
      light: /icons/shield-check-light.svg
      dark: /icons/shield-check-dark.svg
    title: Limits on AI spend
    details: A monthly cap on AI research runs and a reserve on your Claude usage windows. Free checks keep running when AI checks pause.
    link: /guide/claude-usage
    linkText: About Claude usage
---
