<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  SOURCE_LABELS, dayToMs, formatMoney, formatLongDay, formatShortDay
} from '../format.js'
import {
  focusedSeries, keepFocus, niceStep, priceDomain, toggleFocus
} from '../chartFocus.js'
import { busiestCategory } from '../insightsView.js'
import { useSort } from '../useSort.js'
import SortHeader from './SortHeader.vue'

const emit = defineEmits(['select-day'])

const props = defineProps({
  daily: { type: Array, default: () => [] },
  rules: { type: Object, default: () => ({}) },
  categories: { type: Array, default: () => [] }
})

const showMuted = defineModel('showMuted', { type: Boolean, default: false })

const MAX_SERIES = 8
const MARGIN = { top: 14, right: 16, bottom: 28, left: 54 }

const wrap = ref(null)
const width = ref(640)
const hoverMs = ref(null)
const showTable = ref(false)
let observer = null

const height = computed(() => (width.value < 520 ? 250 : 330))
const plotWidth = computed(() => width.value - MARGIN.left - MARGIN.right)
const plotHeight = computed(() => height.value - MARGIN.top - MARGIN.bottom)

const chosenCategory = ref(null)

const liveRows = computed(() => props.daily.filter(({ muted }) => !muted))

const mutedCount = computed(() => props.daily.length - liveRows.value.length)

const shownRows = computed(() => (showMuted.value ? props.daily : liveRows.value))

const liveCategories = computed(() => new Set(liveRows.value.map(({ category }) => category)))

const categoryOptions = computed(() => {
  const present = new Set(shownRows.value.map(({ category }) => category).filter(Boolean))
  const ordered = props.categories.map(({ id }) => id).filter((id) => present.has(id))
  return [...ordered, ...[...present].filter((id) => !ordered.includes(id))]
})

const optionLabel = (id) => (liveCategories.value.has(id) ? id : `${id} (muted)`)

const category = computed(() => (categoryOptions.value.includes(chosenCategory.value)
  ? chosenCategory.value
  : busiestCategory({
    rows: liveRows.value.length ? liveRows.value : shownRows.value,
    order: categoryOptions.value
  })))

const slots = computed(() => {
  const names = [...new Set(props.daily.map(({ retailer }) => retailer?.trim()).filter(Boolean))]
  return new Map(names.sort((a, b) => a.localeCompare(b)).map((name, index) => [name, index + 1]))
})

const focused = ref(null)

const allSeries = computed(() => {
  const inCategory = shownRows.value
    .filter((row) => !category.value || row.category === category.value)
  return [
    ...buildSeries(inCategory.filter(({ muted }) => !muted)),
    ...buildMutedSeries(inCategory.filter(({ muted }) => muted))
  ]
})

const series = computed(() => focusedSeries({ series: allSeries.value, focused: focused.value }))

const shownSources = computed(() => {
  const present = new Set(allSeries.value
    .flatMap(({ points }) => points.map(({ source }) => source)))
  return Object.entries(SOURCE_LABELS).filter(([source]) => present.has(source))
})

const caps = computed(() => groupCaps(categoryRules.value))

const categoryRules = computed(() => (category.value && props.rules?.[category.value]
  ? { [category.value]: props.rules[category.value] }
  : {}))

const allDays = computed(() => {
  const days = new Set(series.value.flatMap((line) => line.points.map((point) => point.ms)))
  return [...days].sort((a, b) => a - b)
})

const xDomain = computed(() => {
  const [first] = allDays.value
  const last = allDays.value.at(-1)
  if (first === last) return [first - 86400000, last + 86400000]
  return [first, last]
})

const yDomain = computed(() =>
  priceDomain({ series: series.value, capValues: caps.value.map((cap) => cap.value) })
)

const yTicks = computed(() => {
  const [low, high] = yDomain.value
  const step = niceStep((high - low) / 4)
  const first = Math.ceil(low / step) * step
  const ticks = []
  for (let value = first; value <= high + 1e-6; value += step) ticks.push(value)
  return ticks
})

const xTicks = computed(() => {
  const [start, end] = xDomain.value
  const count = Math.max(2, Math.min(6, Math.floor(plotWidth.value / 90)))
  const span = end - start
  const ticks = Array.from({ length: count }, (_, index) =>
    Math.round((start + (span * index) / (count - 1)) / 86400000) * 86400000)
  return [...new Set(ticks)]
})

const lines = computed(() =>
  series.value.map((line) => ({
    ...line,
    path: line.points
      .map((point, index) => `${index ? 'L' : 'M'}${scaleX(point.ms)},${scaleY(point.value)}`)
      .join(' '),
    dots: line.points.map((point) => ({
      x: scaleX(point.ms),
      y: scaleY(point.value),
      source: point.source
    }))
  }))
)

const capLines = computed(() =>
  caps.value.map((cap) => ({
    ...cap,
    y: scaleY(cap.value),
    text: `Alert at ${formatMoney(cap.value)}`,
    description: `Alert price ${formatMoney(cap.value)}: ${cap.categories.join(', ')}`
  }))
)

const hover = computed(() => {
  if (hoverMs.value === null) return null
  const rows = series.value
    .map((line) => ({ line, point: line.points.find((point) => point.ms === hoverMs.value) }))
    .filter(({ point }) => point)
    .sort((a, b) => a.point.value - b.point.value)
  const x = scaleX(hoverMs.value)
  return { x, rows, flip: x > plotWidth.value * 0.55 + MARGIN.left }
})

const tableRows = computed(() =>
  allDays.value
    .map((ms) => ({
      ms,
      cells: series.value.map((line) => line.points.find((point) => point.ms === ms)?.value)
    }))
    .reverse()
)

const tableColumns = computed(() => ({
  day: (row) => row.ms,
  ...Object.fromEntries(series.value.map((line, index) => [seriesColumn(index), cellAt(index)]))
}))

const seriesColumn = (index) => `series-${index}`

const cellAt = (index) => (row) => row.cells[index]

const tableSort = useSort({ rows: tableRows, columns: tableColumns })

const isEmpty = computed(() => !allSeries.value.length)

const focusLegend = (name) => {
  focused.value = toggleFocus({ current: focused.value, name })
  hoverMs.value = null
}


const onPointer = (event) => {
  const box = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - box.left - MARGIN.left
  const [start, end] = xDomain.value
  const target = start + (x / plotWidth.value) * (end - start)
  hoverMs.value = allDays.value.reduce((best, ms) =>
    Math.abs(ms - target) < Math.abs(best - target) ? ms : best
  )
}

const selectDay = (event) => {
  onPointer(event)
  if (hoverMs.value === null) return
  emit('select-day', new Date(hoverMs.value).toISOString().slice(0, 10))
}

const markerPath = ({ source, x, y, radius }) => {
  if (source === 'direct') {
    const edge = radius * 0.9
    return `M${x - edge},${y - edge}h${edge * 2}v${edge * 2}h${-edge * 2}z`
  }
  if (source === 'manual') {
    const reach = radius * 1.3
    return `M${x},${y - reach}L${x + reach},${y}L${x},${y + reach}L${x - reach},${y}z`
  }
  const arc = `a${radius},${radius} 0 1,0`
  return `M${x - radius},${y}${arc} ${radius * 2},0${arc} ${-radius * 2},0z`
}

const clearHover = () => {
  hoverMs.value = null
}

const observeWidth = () => {
  if (!wrap.value || observer) return
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(280, Math.floor(entry.contentRect.width))
  })
  observer.observe(wrap.value)
}

onMounted(observeWidth)

watch(wrap, observeWidth)

onUnmounted(() => observer?.disconnect())

const scaleX = (ms) => {
  const [start, end] = xDomain.value
  return MARGIN.left + ((ms - start) / (end - start)) * plotWidth.value
}

const scaleY = (value) => {
  const [low, high] = yDomain.value
  return MARGIN.top + (1 - (value - low) / (high - low)) * plotHeight.value
}

const buildSeries = (rows) => {
  const byRetailer = new Map()
  rows.forEach(({ day, retailer, lowest, source }) => {
    if (typeof lowest !== 'number' || !retailer) return
    const perDay = byRetailer.get(retailer.trim()) ?? new Map()
    keepLowest({ perDay, day, value: lowest, source })
    byRetailer.set(retailer.trim(), perDay)
  })
  const ranked = [...byRetailer.entries()]
    .map(([name, perDay]) => ({ name, perDay, slot: slots.value.get(name) ?? MAX_SERIES }))
    .sort((a, b) => a.slot - b.slot)
  const kept = ranked.filter(({ slot }) => slot < MAX_SERIES)
  const folded = ranked.filter(({ slot }) => slot >= MAX_SERIES)
  const result = kept.map(toLine)
  if (folded.length) result.push(toLine(foldOther(folded)))
  return result
}

const buildMutedSeries = (rows) => {
  const byRetailer = new Map()
  rows.forEach(({ day, retailer, lowest, source }) => {
    if (typeof lowest !== 'number' || !retailer) return
    const perDay = byRetailer.get(retailer.trim()) ?? new Map()
    keepLowest({ perDay, day, value: lowest, source })
    byRetailer.set(retailer.trim(), perDay)
  })
  return [...byRetailer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, perDay]) => ({
      ...toLine({ name: `${name} (muted)`, perDay, slot: 0 }),
      color: 'var(--ink-3)',
      muted: true
    }))
}

const foldOther = (entries) => {
  const perDay = new Map()
  entries.forEach((entry) => entry.perDay.forEach(({ value, source }, day) =>
    keepLowest({ perDay, day, value, source })))
  return { name: `Other (${entries.length})`, perDay, slot: MAX_SERIES }
}

const keepLowest = ({ perDay, day, value, source }) => {
  const current = perDay.get(day)
  if (current && current.value <= value) return
  perDay.set(day, { value, source })
}

const toLine = ({ name, perDay, slot }) => {
  const points = [...perDay.entries()]
    .map(([day, { value, source }]) => ({ ms: dayToMs(day), value, source }))
    .sort((a, b) => a.ms - b.ms)
  return { name, color: `var(--s${slot})`, points }
}

const groupCaps = (rules) => {
  const byValue = new Map()
  Object.entries(rules ?? {}).forEach(([category, rule]) => {
    if (typeof rule?.maxPrice !== 'number') return
    byValue.set(rule.maxPrice, [...(byValue.get(rule.maxPrice) ?? []), category])
  })
  return [...byValue.entries()]
    .map(([value, categories]) => ({ value, categories }))
    .sort((a, b) => a.value - b.value)
}

watch(allSeries, (lines) => {
  focused.value = keepFocus({ focused: focused.value, names: lines.map(({ name }) => name) })
})</script>

<template>
  <div class="chart-card card">
    <div v-if="isEmpty" class="chart-empty">
      <h3>No price history in this range</h3>
      <p class="muted">Prices appear here after the first successful run.</p>
    </div>

    <template v-else>
      <div v-if="categoryOptions.length > 1 || mutedCount" class="chart-filter">
        <template v-if="categoryOptions.length > 1">
          <span class="filter-label" id="chart-category">Category</span>
          <ul class="chips" aria-labelledby="chart-category">
            <li v-for="option in categoryOptions" :key="option">
              <button
                class="chip"
                type="button"
                :aria-pressed="category === option"
                @click="chosenCategory = option"
              >
                {{ optionLabel(option) }}
              </button>
            </li>
          </ul>
        </template>
        <label v-if="mutedCount" class="check muted-switch">
          <input v-model="showMuted" type="checkbox" />
          <span>Show muted</span>
        </label>
      </div>

      <ul class="legend" aria-label="Retailers">
        <li v-for="line in allSeries" :key="line.name" :class="{ 'muted-key': line.muted }">
          <button
            class="legend-item"
            type="button"
            :aria-pressed="focused === line.name"
            :class="{ focused: focused === line.name, dimmed: focused && focused !== line.name }"
            @click="focusLegend(line.name)"
          >
            <svg width="18" height="10" aria-hidden="true">
              <line
                x1="1"
                x2="17"
                y1="5"
                y2="5"
                :stroke="line.color"
                stroke-width="2"
                :stroke-dasharray="line.muted ? '3 3' : null"
              />
              <circle cx="9" cy="5" r="3" :fill="line.color" />
            </svg>
            {{ line.name }}
          </button>
        </li>
        <li v-for="[source, label] in shownSources" :key="source" class="source-key">
          <svg width="14" height="14" aria-hidden="true">
            <path
              :d="markerPath({ source, x: 7, y: 7, radius: 4 })"
              fill="var(--ink-3)"
            />
          </svg>
          {{ label }}
        </li>
        <li v-if="caps.length" class="cap-key">
          <svg width="18" height="10" aria-hidden="true">
            <line
              x1="1"
              x2="17"
              y1="5"
              y2="5"
              stroke="var(--cap)"
              stroke-width="1.5"
              stroke-dasharray="4 3"
            />
          </svg>
          Alert price
        </li>
      </ul>

      <div ref="wrap" class="plot">
        <svg
          :width="width"
          :height="height"
          :viewBox="`0 0 ${width} ${height}`"
          role="img"
          aria-label="Lowest price after promos per retailer by day"
          @pointermove="onPointer"
          @pointerdown="onPointer"
          @pointerleave="clearHover"
          @click="selectDay"
        >
          <g class="grid">
            <g v-for="tick in yTicks" :key="tick">
              <line
                :x1="MARGIN.left"
                :x2="width - MARGIN.right"
                :y1="scaleY(tick)"
                :y2="scaleY(tick)"
              />
              <text :x="MARGIN.left - 8" :y="scaleY(tick) + 4" text-anchor="end">
                {{ formatMoney(tick) }}
              </text>
            </g>
            <text
              v-for="(tick, index) in xTicks"
              :key="tick"
              :x="scaleX(tick)"
              :y="height - 8"
              :text-anchor="index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'"
            >
              {{ formatShortDay(tick) }}
            </text>
          </g>

          <g v-for="cap in capLines" :key="cap.value">
            <title>{{ cap.description }}</title>
            <line
              :x1="MARGIN.left"
              :x2="width - MARGIN.right"
              :y1="cap.y"
              :y2="cap.y"
              stroke="var(--cap)"
              stroke-width="1.5"
              stroke-dasharray="5 4"
            />
            <text class="cap-label" :x="width - MARGIN.right - 2" :y="cap.y - 5" text-anchor="end">
              {{ cap.text }}
            </text>
          </g>

          <line
            v-if="hover"
            class="crosshair"
            :x1="hover.x"
            :x2="hover.x"
            :y1="MARGIN.top"
            :y2="height - MARGIN.bottom"
          />

          <g v-for="line in lines" :key="line.name" :class="{ 'muted-line': line.muted }">
            <path
              :d="line.path"
              fill="none"
              :stroke="line.color"
              :stroke-dasharray="line.muted ? '4 4' : null"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
            <path
              v-for="(dot, index) in line.dots"
              :key="index"
              :d="markerPath({ source: dot.source, x: dot.x, y: dot.y, radius: 4 })"
              :fill="line.color"
              class="dot"
            />
          </g>

          <g v-if="hover">
            <path
              v-for="{ line, point } in hover.rows"
              :key="line.name"
              :d="markerPath({
                source: point.source, x: hover.x, y: scaleY(point.value), radius: 6
              })"
              :fill="line.color"
              class="dot"
            />
          </g>
        </svg>

        <div
          v-if="hover"
          class="tooltip"
          :style="{
            top: `${MARGIN.top}px`,
            left: hover.flip ? 'auto' : `${hover.x + 12}px`,
            right: hover.flip ? `${width - hover.x + 12}px` : 'auto'
          }"
        >
          <strong>{{ formatLongDay(hoverMs) }}</strong>
          <div v-for="{ line, point } in hover.rows" :key="line.name" class="tip-row">
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" :fill="line.color" />
            </svg>
            <span>{{ line.name }}</span>
            <span class="num">{{ formatMoney(point.value) }}</span>
          </div>
          <span class="tip-hint muted">Click for the evidence of this day</span>
        </div>
      </div>

      <button
        class="table-toggle"
        type="button"
        :aria-expanded="showTable"
        @click="showTable = !showTable"
      >
        {{ showTable ? 'Hide table' : 'Show as table' }}
      </button>

      <div v-if="showTable" class="table-wrap data-table">
        <table>
          <thead>
            <tr>
              <SortHeader :sort="tableSort" column="day">Day</SortHeader>
              <SortHeader v-for="(line, index) in series" :key="line.name" :sort="tableSort"
                :column="seriesColumn(index)" class="right">{{ line.name }}</SortHeader>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableSort.sorted.value" :key="row.ms">
              <td class="num">{{ formatShortDay(row.ms) }}</td>
              <td v-for="(cell, index) in row.cells" :key="index" class="num right">
                {{ cell === undefined ? '-' : formatMoney(cell) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chart-card {
  padding: var(--space-4) var(--space-4) var(--space-3);
}

.chart-empty {
  padding: var(--space-6) var(--space-2);
  text-align: center;
}

.chart-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}

.filter-label {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  list-style: none;
  margin: 0 0 var(--space-2);
  padding: 0 0 0 var(--space-1);
  font-size: var(--text-caption);
  color: var(--ink-2);
}

.muted-switch {
  margin-left: auto;
  align-items: center;
}

.muted-line {
  opacity: 0.6;
}

.muted-key {
  color: var(--ink-3);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: 999px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-wrap: balance;
}

.legend-item:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}

.legend-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.legend-item.focused {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--ink);
  font-weight: 700;
}

.legend-item.dimmed {
  opacity: 0.5;
}

.plot {
  position: relative;
  width: 100%;
  touch-action: pan-y;
}

svg {
  display: block;
  overflow: visible;
  max-width: 100%;
}

.grid line {
  stroke: var(--grid);
  stroke-width: 1;
}

.grid text,
.cap-label {
  font-family: var(--font-mono);
  font-feature-settings: 'cv01' 1, 'tnum' 1;
  font-size: var(--text-label);
  fill: var(--ink-3);
}

.cap-label {
  fill: var(--cap);
}

.crosshair {
  stroke: var(--ink-3);
  stroke-width: 1;
}

.dot {
  stroke: var(--surface);
  stroke-width: 2;
}

.tooltip {
  position: absolute;
  pointer-events: none;
  min-width: 170px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 8px;
  box-shadow: var(--shadow);
  font-size: var(--text-caption);
  z-index: 2;
}

.tip-hint {
  display: block;
  margin-top: var(--space-2);
  font-size: var(--text-label);
}

svg {
  cursor: pointer;
}

.tip-row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.table-toggle {
  margin: var(--space-2) 0 0 var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--text-caption);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.data-table {
  margin-top: var(--space-3);
  max-height: 320px;
  overflow: auto;
}
</style>
