export const busiestCategory = ({ rows, order }) => {
  const counts = rows.reduce(
    (total, { category }) => total.set(category, (total.get(category) ?? 0) + 1),
    new Map()
  )
  return order.reduce((best, id) =>
    (best === null || (counts.get(id) ?? 0) > (counts.get(best) ?? 0) ? id : best), null)
}
