import { secondHandKinds } from './second-hand.js'

export const au = {
  id: 'au',
  country: 'Australia',
  currency: 'AUD',
  locale: 'en-AU',
  timeZone: 'Australia/Sydney',
  maxPrice: 200_000,
  fetchDomains: ['*.au', 'kogan.com', '*.kogan.com', 'marketplace.qantas.com'],
  homeHostSuffixes: ['.au'],
  shopifyCurrency: 'home-host',
  postcode: { pattern: /^\d{4}$/, problem: 'must be 4 digits' },
  deliveryLabels: { postcode: 'postcode', locality: 'suburb' },
  ebayRetailer: 'eBay AU',
  exampleDomain: 'example.com.au',
  retailers: [
    { names: ['Bunnings'], hosts: ['bunnings.com.au'] },
    { names: ['JB Hi-Fi', 'JB HiFi'], hosts: ['jbhifi.com.au'] },
    { names: ['Harvey Norman'], hosts: ['harveynorman.com.au'] },
    { names: ['The Good Guys', 'Good Guys'], hosts: ['thegoodguys.com.au'] },
    { names: ['Amazon'], hosts: ['amazon.com.au'] },
    { names: ['eBay'], hosts: ['ebay.com.au', 'ebay.com'] },
    { names: ['Kogan'], hosts: ['kogan.com', 'kogan.com.au'] },
    { names: ['Appliances Online'], hosts: ['appliancesonline.com.au'] },
    { names: ['Catch'], hosts: ['catch.com.au'] },
    { names: ['Myer'], hosts: ['myer.com.au'] },
    { names: ['David Jones'], hosts: ['davidjones.com'] },
    { names: ['Bing Lee'], hosts: ['binglee.com.au'] },
    { names: ['Big W'], hosts: ['bigw.com.au'] },
    { names: ['Kmart'], hosts: ['kmart.com.au'] },
    { names: ['Target'], hosts: ['target.com.au'] },
    { names: ['Officeworks'], hosts: ['officeworks.com.au'] },
    { names: ['Mitre 10'], hosts: ['mitre10.com.au'] },
    { names: ['Total Tools'], hosts: ['totaltools.com.au'] },
    { names: ['Sydney Tools'], hosts: ['sydneytools.com.au'] },
    { names: ['Supercheap Auto'], hosts: ['supercheapauto.com.au'] },
    { names: ['Repco'], hosts: ['repco.com.au'] },
    { names: ['Temple & Webster', 'Temple and Webster'], hosts: ['templeandwebster.com.au'] },
    { names: ['MyDeal'], hosts: ['mydeal.com.au'] },
    { names: ['Qantas Marketplace'], hosts: ['marketplace.qantas.com'] },
    { names: ['Kärcher', 'Karcher'], hosts: ['kaercher.com', 'karcher.com.au'] },
    { names: ['OzBargain'], hosts: ['ozbargain.com.au'] },
    { names: ['BuyWisely'], hosts: ['buywisely.com.au'] },
    { names: ['PriceHipster'], hosts: ['pricehipster.com'] },
    { names: ['Getprice'], hosts: ['getprice.com.au'] },
    { names: ['ShopBot'], hosts: ['shopbot.com.au'] },
    { names: ['StaticICE'], hosts: ['staticice.com.au'] },
    { names: ['PriceMe'], hosts: ['priceme.com.au'] }
  ],
  memberships: {
    defaults: ['eBay Plus'],
    suggestions: [
      'eBay Plus', 'Bunnings PowerPass', 'Amazon Prime', 'OnePass', 'Costco', 'JB Perks',
      'Myer one', 'Flybuys', 'Everyday Rewards'
    ],
    requirements: [
      { host: /(^|\.)trade\.bunnings\.com\.au$/i, membership: 'Bunnings PowerPass' },
      { host: /(^|\.)costco\.com\.au$/i, membership: 'Costco' }
    ]
  },
  saleEvents: ({ year, nthWeekday, addDays }) => {
    const blackFriday = addDays(nthWeekday({ year, month: 11, weekday: 4, n: 4 }), 1)
    return [
      { name: 'Click Frenzy', date: nthWeekday({ year, month: 11, weekday: 2, n: 2 }) },
      { name: 'Black Friday', date: blackFriday },
      { name: 'Cyber Monday', date: addDays(blackFriday, 3) },
      { name: 'Boxing Day', date: `${year}-12-26` },
      { name: 'EOFY', date: `${year}-06-30` }
    ]
  },
  research: {
    job: 'Your job: find every current Australian listing of the product below and report each ' +
      'one as JSON.',
    kitRules: 'Australia-only, in-stock, and verification rules',
    bundleRetailers: 'any Australian retailer',
    urlField: 'the exact page URL you opened, or the OzBargain post URL.',
    membershipExample: 'for example eBay Plus member deals, or an eBay Plus coupon code on the ' +
      'listing or the eBay deals page',
    fetchScope: 'WebFetch opens only Australian (.au) sites, the sites under SOURCES, and a ' +
      'few known Australian retailers; a denied fetch counts as blocked.',
    retailerNote: ' For eBay, set retailer to "eBay AU".',
    marketRules: [
      {
        key: 'dealPosts',
        text: ({ today }) =>
          `OzBargain: you may include a post that is less than 7 days old (today is ${today}) ` +
          'and not marked expired in the comments. ' +
          'Set verified to false, and put the post URL in url and evidence. ' +
          'Reject posts that are 7 days old or older, or marked expired.'
      },
      {
        key: 'market',
        text: () => 'Accept only Australian retailers that sell in AUD, with local stock and an ' +
          'Australian warranty. Reject overseas listings (US, NZ, Canada, UK, and others). ' +
          'These appear often in search results.'
      },
      {
        key: 'secondHand',
        text: ({ ref, refurbished }) => 'Reject Gumtree, Facebook Marketplace, and any ' +
          `${secondHandKinds({ ref, refurbished })}. Reject marketplace third-party sellers, ` +
          `except on eBay AU as rule ${ref('ebay')} allows.`
      },
      {
        key: 'ebay',
        text: () => 'eBay AU: accept a listing only if the condition is New, the seller is an ' +
          'Australian business (item located in Australia and ships from Australia), and the ' +
          'listing states an Australian warranty or the seller is the brand\'s or a known ' +
          'retailer\'s official eBay store. Reject used, refurbished, open-box, overseas, ' +
          'grey-import, and private sellers. Put the seller name in notes (for example "Sold by ' +
          'X on eBay").'
      },
      {
        key: 'amazon',
        text: () => 'Amazon.com.au: accept a listing only if it is sold by Amazon AU or by the ' +
          'brand itself. Reject every other seller.'
      }
    ]
  },
  wizard: {
    buyerPlace: ' in Australia',
    modelsSoldBy: 'Australian retailers',
    noRetailer: 'no Australian retailer',
    manufacturerPage: 'manufacturer\'s Australian page',
    rrpSource: 'manufacturer\'s Australian site',
    retailersStep: 'Australian retailers that stock it new, with a short note per retailer ' +
      'when needed (for example "Amazon AU only when sold by Amazon"). eBay AU counts as a ' +
      'retailer only for New items from Australian business sellers (item located in ' +
      'Australia, ships from Australia, Australian warranty stated or an official brand or ' +
      'retailer eBay store). Reject used, refurbished, open-box, overseas, grey-import, and ' +
      'private eBay sellers. Gumtree and Facebook Marketplace stay rejected. Put the eBay ' +
      'seller name in notes.',
    saleEvents: 'Black Friday, Cyber Monday, Boxing Day, EOFY, brand sales',
    historySources: 'OzBargain and price-comparison sites',
    memberExample: ' (such as eBay Plus deals)',
    dealEvidenceUrl: 'https://www.ozbargain.com.au/node/000000',
    exampleSaleName: 'Black Friday',
    noPlace: 'Australia'
  }
}
