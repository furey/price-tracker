export const SETTING_GROUPS = [
  {
    id: 'phone',
    title: 'Phone alerts',
    icon: 'bell',
    description: 'How alerts reach your phone through ntfy, and the address their links open.',
    keys: ['ntfyToken', 'appTopic', 'dashboardUrl']
  },
  {
    id: 'ai',
    title: 'Claude and AI',
    icon: 'spark',
    description: 'AI research runs on your Claude subscription. These limits decide when it stops.',
    keys: ['claudeOauthToken', 'claudeReservePercent', 'claudeSessionReservePercent',
      'aiMonthlyCap']
  },
  {
    id: 'shopping',
    title: 'Shopping',
    icon: 'bag',
    description: 'Which member prices count for you, and where delivery is priced to.',
    keys: ['memberships', 'deliveryPostcode', 'deliverySuburb']
  },
  {
    id: 'region',
    title: 'Region',
    icon: 'globe',
    description: 'The currency prices are in, how numbers and dates look, and the time zone '
      + 'for days and new schedules.',
    keys: ['currency', 'locale', 'timeZone']
  },
  {
    id: 'storage',
    title: 'Storage',
    icon: 'image',
    description: 'How much space screenshots from Chrome checks can use.',
    keys: ['screenshotCapMb']
  },
  {
    id: 'about',
    title: 'About',
    icon: 'info',
    description: 'The app version and where its data is stored.',
    keys: []
  }
]

export const SETTING_EFFECTS = {
  aiMonthlyCap: 'Scheduled AI research stops for the rest of the month once this many runs '
    + 'are used. 0 stops all AI runs. Free checks are not counted.',
  claudeReservePercent: 'AI checks stop when weekly Claude usage passes this percentage, '
    + 'and start again at the weekly reset. Free checks keep running.',
  claudeSessionReservePercent: 'AI checks stop when five-hour session usage passes this '
    + 'percentage, and start again when the session resets.',
  claudeOauthToken: 'Every AI check and draft runs Claude with the new token. A wrong token '
    + 'stops AI checks until you fix it. Use Test Claude login after saving.',
  ntfyToken: 'Alerts are sent to ntfy with the new token. A wrong token stops alerts from '
    + 'reaching your phone.',
  dashboardUrl: 'Links in new alerts open this address. Alerts already sent keep the old link.',
  appTopic: 'Draft notices and the cap notice go to the new topic. Subscribe to it in the ntfy '
    + 'app, or those notices stop reaching your phone.',
  memberships: 'Member-only prices count only for memberships in this list. Lowest prices on '
    + 'the dashboard change at once; alerts use the new list from the next check.',
  currency: 'New prices are recorded and shown in this currency. Prices already recorded keep '
    + 'their old currency, and caps are not converted. Reload the dashboard after saving.',
  screenshotCapMb: 'When screenshots pass this size, the oldest are deleted after the next '
    + 'upload until they fit.',
  locale: 'Prices and dates use this format. Reload the dashboard after saving.',
  timeZone: 'Days, pauses, and new schedules use this time zone. Existing schedules keep '
    + 'their own time zone. Reload the dashboard after saving.'
}

export const maskedPreview = (value) => {
  const text = String(value ?? '')
  return text.length < 12 ? 'New token' : `New token ending ${text.slice(-4)}`
}
