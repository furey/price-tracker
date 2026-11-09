import { computed, inject, onUnmounted, provide, reactive, watch } from 'vue'
import { errorsFor, pathOf } from './itemForm.js'

export const provideForm = ({ errors }) => {
  const claims = reactive(new Map())
  const claim = (path) => claims.set(path, (claims.get(path) ?? 0) + 1)
  const release = (path) => {
    const count = (claims.get(path) ?? 1) - 1
    if (count <= 0) claims.delete(path)
    else claims.set(path, count)
  }
  const unclaimed = ({ prefixes }) => errors.value.filter((error) => {
    const path = pathOf(error)
    if (claims.has(path)) return false
    return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)
      || path.startsWith(`${prefix}[`))
  })
  provide(FORM_KEY, { errors, claim, release, unclaimed })
}

export const useFieldErrors = (pathSource) => {
  const form = inject(FORM_KEY)
  const path = computed(() => (typeof pathSource === 'function' ? pathSource() : pathSource))
  watch(path, (next, previous) => {
    if (previous) form.release(previous)
    form.claim(next)
  }, { immediate: true })
  onUnmounted(() => form.release(path.value))
  return computed(() => errorsFor({ errors: form.errors.value, path: path.value }))
}

export const useSectionErrors = (prefixes) => {
  const form = inject(FORM_KEY)
  return computed(() => form.unclaimed({ prefixes }))
}

export const useInvalid = () => {
  const form = inject(FORM_KEY)
  return (path) => (form.errors.value.some((error) => pathOf(error) === path) ? 'true' : undefined)
}

const FORM_KEY = Symbol('item-form')
