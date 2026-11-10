export const pricePerUnit = (listing) => {
  const effective = listing.effectivePrice ?? listing.price
  const count = listing.unitCount
  return isPositive(effective) && isPositive(count) ? effective / count : null
}

const isPositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
