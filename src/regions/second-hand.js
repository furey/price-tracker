export const secondHandKinds = ({ ref, refurbished = false, renewed = false }) => {
  const kinds = refurbished
    ? ['used', ...(renewed ? ['renewed'] : []), 'open-box']
    : ['refurbished', 'used', ...(renewed ? ['renewed'] : []), 'open-box']
  const serialComma = kinds.length > 2 ? ',' : ''
  const listed = `${kinds.slice(0, -1).join(', ')}${serialComma} or ${kinds.at(-1)} item`
  return refurbished ? `${listed} (refurbished stock follows rule ${ref('refurbished')})` : listed
}
