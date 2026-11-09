export const copyText = async (text) => {
  if (await copiedWithApi(text)) return true
  return copiedWithCommand(text)
}

const copiedWithApi = async (text) => {
  if (!window.isSecureContext || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const copiedWithCommand = (text) => {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
