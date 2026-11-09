export const us = {
  id: 'us',
  country: 'United States',
  currency: 'USD',
  locale: 'en-US',
  timeZone: 'America/New_York',
  maxPrice: 200_000,
  fetchDomains: [
    'amazon.com', '*.amazon.com', 'walmart.com', '*.walmart.com', 'target.com', '*.target.com',
    'bestbuy.com', '*.bestbuy.com', 'homedepot.com', '*.homedepot.com', 'lowes.com',
    '*.lowes.com', 'costco.com', '*.costco.com', 'bhphotovideo.com', '*.bhphotovideo.com',
    'newegg.com', '*.newegg.com', 'ebay.com', '*.ebay.com', 'slickdeals.net', '*.slickdeals.net'
  ],
  homeHostSuffixes: [],
  shopifyCurrency: 'listed-host',
  postcode: { pattern: /^\d{5}(-\d{4})?$/, problem: 'must be a 5-digit ZIP code' },
  deliveryLabels: { postcode: 'ZIP code', locality: 'city' },
  ebayRetailer: 'eBay',
  exampleDomain: 'example.com',
  retailers: [
    { names: ['Amazon'], hosts: ['amazon.com'] },
    { names: ['Walmart'], hosts: ['walmart.com'] },
    { names: ['Target'], hosts: ['target.com'] },
    { names: ['Best Buy'], hosts: ['bestbuy.com'] },
    { names: ['Home Depot', 'The Home Depot'], hosts: ['homedepot.com'] },
    { names: ['Lowe\'s', 'Lowes'], hosts: ['lowes.com'] },
    { names: ['Costco'], hosts: ['costco.com'] },
    { names: ['B&H', 'B&H Photo', 'B and H'], hosts: ['bhphotovideo.com'] },
    { names: ['Newegg'], hosts: ['newegg.com'] },
    { names: ['eBay'], hosts: ['ebay.com'] },
    { names: ['Slickdeals'], hosts: ['slickdeals.net'] }
  ],
  memberships: {
    defaults: [],
    suggestions: [
      'Amazon Prime', 'Walmart+', 'Target Circle 360', 'Costco', 'Sam\'s Club',
      'My Best Buy Plus'
    ],
    requirements: [
      { host: /(^|\.)costco\.com$/i, membership: 'Costco' },
      { host: /(^|\.)samsclub\.com$/i, membership: 'Sam\'s Club' }
    ]
  },
  saleEvents: ({ year, nthWeekday, addDays }) => {
    const thanksgiving = nthWeekday({ year, month: 11, weekday: 4, n: 4 })
    const blackFriday = addDays(thanksgiving, 1)
    return [
      { name: 'Presidents\' Day', date: nthWeekday({ year, month: 2, weekday: 1, n: 3 }) },
      { name: 'Memorial Day', date: addDays(nthWeekday({ year, month: 6, weekday: 1, n: 1 }), -7) },
      {
        name: 'Prime Day (approximate)',
        date: nthWeekday({ year, month: 7, weekday: 2, n: 2 })
      },
      { name: 'Labor Day', date: nthWeekday({ year, month: 9, weekday: 1, n: 1 }) },
      { name: 'Black Friday', date: blackFriday },
      { name: 'Cyber Monday', date: addDays(blackFriday, 3) }
    ]
  },
  research: {
    job: 'Your job: find every current US listing of the product below and report each one ' +
      'as JSON.',
    kitRules: 'US-only, in-stock, and verification rules',
    bundleRetailers: 'any US retailer',
    urlField: 'the exact page URL you opened, or the Slickdeals post URL.',
    membershipExample: 'for example an Amazon Prime or Walmart+ member price, or a member ' +
      'coupon shown on the listing',
    fetchScope: 'WebFetch opens only the sites under SOURCES and a few known US retailers; a ' +
      'denied fetch counts as blocked.',
    retailerNote: ' For eBay, set retailer to "eBay".',
    marketRules: [
      {
        key: 'dealPosts',
        text: ({ today }) =>
          `Slickdeals: you may include a post that is less than 7 days old (today is ${today}) ` +
          'and not marked expired. ' +
          'Set verified to false, and put the post URL in url and evidence. ' +
          'Reject posts that are 7 days old or older, or marked expired.'
      },
      {
        key: 'market',
        text: () => 'Accept only US retailers that sell in USD and ship within the United ' +
          'States, with a US warranty. Reject overseas listings (Canada, UK, Australia, and ' +
          'others). These appear often in search results.'
      },
      {
        key: 'tax',
        text: () => 'US prices exclude sales tax. Record the listed price before tax. Never ' +
          'add sales tax to price, effectivePrice, or deliveryCost.'
      },
      {
        key: 'secondHand',
        text: ({ ref }) => 'Reject Craigslist, Facebook Marketplace, and any refurbished, used, ' +
          'renewed, or open-box item. Reject marketplace third-party sellers, except on eBay as ' +
          `rule ${ref('ebay')} allows.`
      },
      {
        key: 'ebay',
        text: () => 'eBay: accept a listing only if the condition is New, the seller is a US ' +
          'business (item located in the United States and ships from the United States), and ' +
          'the listing states a US warranty or the seller is the brand\'s or a known ' +
          'retailer\'s official eBay store. Reject used, refurbished, open-box, overseas, ' +
          'grey-import, and private sellers. Put the seller name in notes (for example "Sold by ' +
          'X on eBay").'
      },
      {
        key: 'amazon',
        text: () => 'Amazon.com: accept a listing only if it is sold by Amazon.com or by the ' +
          'brand itself. Reject every other seller.'
      },
      {
        key: 'walmart',
        text: () => 'Walmart.com: accept a listing only if it is sold by Walmart.com or by the ' +
          'brand itself. Reject Walmart Marketplace third-party sellers.'
      }
    ]
  },
  wizard: {
    buyerPlace: ' in the United States',
    modelsSoldBy: 'US retailers',
    noRetailer: 'no US retailer',
    manufacturerPage: 'manufacturer\'s US page',
    rrpSource: 'manufacturer\'s US site (list price or MSRP)',
    retailersStep: 'US retailers that stock it new, with a short note per retailer when ' +
      'needed (for example "Amazon only when sold by Amazon.com"). eBay counts as a retailer ' +
      'only for New items from US business sellers (item located in the United States, ships ' +
      'from the United States, US warranty stated or an official brand or retailer eBay ' +
      'store). Reject used, refurbished, renewed, open-box, overseas, grey-import, and private ' +
      'sellers, and Walmart Marketplace third-party sellers. Craigslist and Facebook ' +
      'Marketplace stay rejected. Put the eBay seller name in notes. Prices exclude sales tax.',
    saleEvents: 'Presidents\' Day, Memorial Day, Prime Day, Labor Day, Black Friday, Cyber ' +
      'Monday, brand sales',
    historySources: 'Slickdeals, camelcamelcamel, and price-comparison sites',
    memberExample: ' (such as Amazon Prime or Walmart+ prices)',
    dealEvidenceUrl: 'https://slickdeals.net/f/000000',
    exampleSaleName: 'Black Friday',
    noPlace: 'United States'
  }
}
