export const generic = {
  id: 'generic',
  country: null,
  currency: 'USD',
  locale: 'en-US',
  timeZone: 'UTC',
  maxPrice: 200_000,
  fetchDomains: [],
  homeHostSuffixes: [],
  shopifyCurrency: 'listed-host',
  postcode: {
    pattern: /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/,
    problem: 'use 2 to 12 letters, digits, spaces, or hyphens'
  },
  deliveryLabels: { postcode: 'postcode', locality: 'suburb' },
  ebayRetailer: 'eBay',
  exampleDomain: 'example.com',
  retailers: [],
  memberships: {
    defaults: [],
    suggestions: [],
    requirements: []
  },
  saleEvents: () => [],
  research: {
    job: 'Your job: find every current listing of the product below, sold new by a retailer ' +
      'that sells in the buyer\'s currency, and report each one as JSON.',
    kitRules: 'currency, in-stock, and verification rules',
    bundleRetailers: 'any retailer',
    urlField: 'the exact page URL you opened.',
    membershipExample: 'for example a member-only price or member coupon shown on the listing',
    fetchScope: 'WebFetch opens only the sites under SOURCES; a denied fetch counts as blocked.',
    retailerNote: '',
    marketRules: [
      {
        key: 'market',
        text: ({ currency }) => `Accept only retailers that sell new in ${currency}. ` +
          'Reject listings priced in another currency, and overseas or grey-import listings.'
      },
      {
        key: 'secondHand',
        text: () => 'Reject classified-ad sites, and any refurbished, used, or open-box item. ' +
          'Reject marketplace third-party sellers unless the brand or a known retailer sells ' +
          'the item.'
      }
    ]
  },
  wizard: {
    buyerPlace: '',
    modelsSoldBy: 'retailers in the buyer\'s currency',
    noRetailer: 'no retailer in the buyer\'s currency',
    manufacturerPage: 'manufacturer\'s product page',
    rrpSource: 'manufacturer\'s site',
    retailersStep: 'Retailers that stock it new and sell in the buyer\'s currency, with a ' +
      'short note per retailer when needed. Reject used, refurbished, open-box, overseas, ' +
      'grey-import, and private sellers, and classified-ad sites.',
    saleEvents: 'major sale events, brand sales',
    historySources: 'deal and price-comparison sites',
    memberExample: '',
    dealEvidenceUrl: 'https://deals.example.com/post/000000',
    exampleSaleName: 'Black Friday',
    noPlace: 'not given'
  }
}
