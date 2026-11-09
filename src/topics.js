export const TOPIC_PREFIX = 'pt'
export const MAX_TOPIC_LENGTH = 64

export const topicName = ({ slug, hex }) => {
  const room = MAX_TOPIC_LENGTH - TOPIC_PREFIX.length - hex.length - 2
  return `${TOPIC_PREFIX}-${slug.slice(0, room).replace(/-+$/, '')}-${hex}`
}

export const withTopicPrefix = (slug) => (slug.startsWith(`${TOPIC_PREFIX}-`)
  ? slug
  : `${TOPIC_PREFIX}-${slug}`)
