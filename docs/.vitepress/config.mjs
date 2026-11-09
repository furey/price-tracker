import { defineConfig } from 'vitepress'
import { headingIcon } from './headingIcon.mjs'
import { keepLastWordsTogether } from './keepLastWordsTogether.mjs'

const repo = 'https://github.com/furey/price-tracker'
const site = 'https://furey.github.io/price-tracker/'
const description =
  'A self-hosted service that checks retail prices on a schedule and sends an ntfy alert when a listing meets your rules.'
const ogImage = `${site}og.png`
const ogImageAlt =
  'Price Tracker: tell it what you want to buy, get notified when the price is right. Beside the headline, the dashboard item list in a browser window.'

const canonicalPath = (relativePath) =>
  `${site}${relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`

const pageTitle = (pageData) =>
  pageData.frontmatter.layout === 'home' || !pageData.title
    ? 'Price Tracker'
    : `${pageData.title} · Price Tracker`

const stripAlertTitleBreak = (md) => {
  md.core.ruler.before('normalize', 'strip-alert-title-br', (state) => {
    state.src = state.src.replace(
      /(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])<br\s*\/?>/g,
      '$1'
    )
  })
}

export default defineConfig({
  base: '/price-tracker/',
  lang: 'en-AU',
  title: 'Price Tracker',
  description,
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,
  srcExclude: ['README.md', '**/node_modules/**'],
  sitemap: { hostname: site },
  markdown: {
    config: (md) => {
      stripAlertTitleBreak(md)
      md.use(keepLastWordsTogether)
      headingIcon(md)
    }
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/price-tracker/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/price-tracker/favicon-32.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/price-tracker/apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#fafafa' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#09090b' }],
    ['meta', { name: 'color-scheme', content: 'dark light' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Price Tracker' }],
    ['meta', { property: 'og:locale', content: 'en_AU' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],

  transformPageData(pageData) {
    const canonical = canonicalPath(pageData.relativePath)
    const title = pageTitle(pageData)
    const pageDescription =
      pageData.frontmatter.description || pageData.description || description
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:image', content: ogImage }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: ogImageAlt }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
      ['meta', { name: 'twitter:image', content: ogImage }],
      ['meta', { name: 'twitter:image:alt', content: ogImageAlt }]
    )
  },

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Price Tracker',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/', activeMatch: '/reference/' },
      { text: 'Discussions', link: `${repo}/discussions` },
      { text: 'GitHub', link: repo }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Start here',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'Getting started', link: '/guide/getting-started' }
          ]
        },
        {
          text: 'Using it',
          collapsed: false,
          items: [
            { text: 'Items', link: '/guide/items' },
            { text: 'Creating an item', link: '/guide/new-item' },
            { text: 'Editing an item', link: '/guide/editing' },
            { text: 'The item page', link: '/guide/item-page' },
            { text: 'Alerts and ntfy', link: '/guide/alerts' },
            { text: 'Tuning', link: '/guide/tuning' }
          ]
        },
        {
          text: 'Checks',
          collapsed: false,
          items: [
            { text: 'Free direct checks', link: '/guide/direct-checks' },
            { text: 'Chrome observations', link: '/guide/chrome-observations' },
            { text: 'Claude usage and the AI cap', link: '/guide/claude-usage' }
          ]
        },
        {
          text: 'Help',
          collapsed: false,
          items: [
            { text: 'Settings', link: '/guide/settings' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'Item config', link: '/reference/item-config' },
            { text: 'Research contract', link: '/reference/research-contract' },
            { text: 'Deciding and alerting', link: '/reference/decisions' },
            { text: 'Database', link: '/reference/database' },
            { text: 'HTTP API', link: '/reference/http-api' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Deployment', link: '/reference/deployment' },
            { text: 'Security model', link: '/reference/security' },
            { text: 'Development', link: '/reference/development' }
          ]
        }
      ]
    },

    outline: { level: [2, 3], label: 'On this page' },

    socialLinks: [
      { icon: 'github', link: repo }
    ],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub'
    },

    search: {
      provider: 'local'
    },

    lastUpdated: {
      text: 'Updated',
      formatOptions: { dateStyle: 'medium', timeStyle: 'short' }
    },

    docFooter: {
      prev: 'Previous',
      next: 'Next'
    },

    footer: {
      message: 'Not affiliated with or endorsed by Anthropic, ntfy, or any retailer.',
      copyright: `<a href="${repo}">Source on GitHub</a>`
    }
  }
})
