<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { dayToMs, formatMoney, formatShortDay } from '../format.js'

const props = defineProps({
  trend: { type: Object, required: true },
  href: { type: String, default: null }
})

const HEIGHT = 72
const PAD_TOP = 18
const PAD_BOTTOM = 18
const PAD_X = 6
const LABEL_GAP = 7
const ALERT_REACH = 1

const frame = ref(null)
const width = ref(320)
const hovered = ref(null)
let observer = null

const days = computed(() => props.trend.days.map((entry) => ({
  ...entry, ms: dayToMs(entry.day)
})))

const prices = computed(() => days.value.map(({ lowest }) => lowest))

const low = computed(() => Math.min(...prices.value))

const high = computed(() => Math.max(...prices.value))

const showAlert = computed(() => {
  const alert = props.trend.alertPrice
  if (typeof alert !== 'number') return false
  const span = Math.max(high.value - low.value, high.value * 0.02)
  return alert >= low.value - span * ALERT_REACH && alert <= high.value + span * ALERT_REACH
})

const domain = computed(() => {
  const values = showAlert.value ? [...prices.value, props.trend.alertPrice] : prices.value
  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = Math.max((max - min) * 0.08, max * 0.01)
  return { min: min - padding, max: max + padding }
})

const xOf = (ms) => {
  const first = days.value[0].ms
  const last = days.value[days.value.length - 1].ms
  return PAD_X + ((ms - first) / Math.max(1, last - first)) * (width.value - PAD_X * 2)
}

const yOf = (price) => {
  const { min, max } = domain.value
  const plot = HEIGHT - PAD_TOP - PAD_BOTTOM
  return PAD_TOP + (1 - (price - min) / (max - min)) * plot
}

const points = computed(() => days.value.map((entry) => ({
  ...entry, x: xOf(entry.ms), y: yOf(entry.lowest)
})))

const linePath = computed(() => points.value
  .map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
  .join(' '))

const areaPath = computed(() => {
  const first = points.value[0]
  const last = points.value[points.value.length - 1]
  const floor = HEIGHT - PAD_BOTTOM + 6
  return `${linePath.value} L${last.x.toFixed(1)},${floor} L${first.x.toFixed(1)},${floor} Z`
})

const latest = computed(() => points.value[points.value.length - 1])

const focus = computed(() => hovered.value ?? latest.value)

const anchorFor = (x) => {
  if (x < width.value * 0.2) return 'start'
  if (x > width.value * 0.8) return 'end'
  return 'middle'
}

const labelFor = ({ point, kind }) => ({
  key: `${kind}-${point.day}`,
  x: point.x,
  y: kind === 'max' ? point.y - LABEL_GAP : point.y + LABEL_GAP + 9,
  anchor: anchorFor(point.x),
  text: `${kind === 'max' ? 'High' : 'Low'} ${formatMoney(point.lowest)}`
})

const extremes = computed(() => {
  if (low.value === high.value) return []
  const minPoint = points.value.find(({ lowest }) => lowest === low.value)
  const maxPoint = points.value.find(({ lowest }) => lowest === high.value)
  return [
    { point: maxPoint, kind: 'max' },
    { point: minPoint, kind: 'min' }
  ]
    .filter(({ point }) => point.day !== focus.value.day)
    .map(labelFor)
})

const focusLabel = computed(() => {
  const point = focus.value
  const above = point.y - PAD_TOP >= HEIGHT - PAD_BOTTOM - point.y
  return {
    x: point.x,
    y: above ? point.y - LABEL_GAP : point.y + LABEL_GAP + 9,
    anchor: anchorFor(point.x),
    text: hovered.value
      ? `${formatShortDay(point.ms)} ${formatMoney(point.lowest)}`
      : formatMoney(point.lowest)
  }
})

const alertY = computed(() => yOf(props.trend.alertPrice))

const firstDay = computed(() => formatShortDay(days.value[0].ms))

const lastDay = computed(() => formatShortDay(latest.value.ms))

const summary = computed(() => [
  `Lowest price per day for ${props.trend.category}, ${firstDay.value} to ${lastDay.value}.`,
  `Latest ${formatMoney(latest.value.lowest)}, low ${formatMoney(low.value)},`,
  `high ${formatMoney(high.value)}.`,
  typeof props.trend.alertPrice === 'number'
    ? `Alert price ${formatMoney(props.trend.alertPrice)}.`
    : ''
].join(' '))

const track = (event) => {
  const box = frame.value.getBoundingClientRect()
  const x = event.clientX - box.left
  hovered.value = points.value.reduce((best, point) =>
    (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best))
}

const open = () => {
  if (props.href) window.location.hash = props.href
}

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(120, Math.round(entry.contentRect.width))
  })
  observer.observe(frame.value)
})

onUnmounted(() => observer?.disconnect())
</script>

<template>
  <figure class="trend">
    <figcaption class="trend-head">
      <span>Lowest per day</span>
      <span class="trend-category">{{ trend.category }}</span>
    </figcaption>
    <div
      ref="frame"
      class="trend-frame"
      @pointermove="track"
      @pointerleave="hovered = null"
      @click="open"
    >
      <svg
        :width="width"
        :height="HEIGHT"
        :viewBox="`0 0 ${width} ${HEIGHT}`"
        role="img"
        :aria-label="summary"
      >
        <path class="trend-area" :d="areaPath" />
        <line
          v-if="showAlert"
          class="trend-alert"
          :x1="0"
          :x2="width"
          :y1="alertY"
          :y2="alertY"
        />
        <line
          v-if="hovered"
          class="trend-cross"
          :x1="hovered.x"
          :x2="hovered.x"
          :y1="PAD_TOP - 6"
          :y2="HEIGHT - PAD_BOTTOM + 6"
        />
        <path class="trend-line" :d="linePath" />
        <text
          v-for="label in extremes"
          :key="label.key"
          class="trend-text"
          :x="label.x"
          :y="label.y"
          :text-anchor="label.anchor"
        >
          {{ label.text }}
        </text>
        <circle class="trend-dot" :cx="focus.x" :cy="focus.y" r="4" />
        <text
          class="trend-text strong"
          :x="focusLabel.x"
          :y="focusLabel.y"
          :text-anchor="focusLabel.anchor"
        >
          {{ focusLabel.text }}
        </text>
      </svg>
    </div>
    <div class="trend-foot" aria-hidden="true">
      <span class="num">{{ firstDay }}</span>
      <span v-if="showAlert" class="trend-key">
        <i class="dash" />Alert {{ formatMoney(trend.alertPrice) }}
      </span>
      <span v-else-if="typeof trend.alertPrice === 'number'" class="trend-key">
        Alert {{ formatMoney(trend.alertPrice) }}, off the scale
      </span>
      <span class="num">{{ lastDay }}</span>
    </div>
  </figure>
</template>

<style scoped>
.trend {
  position: relative;
  z-index: 1;
  margin: 0 0 var(--space-3);
}

.trend-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
  font-size: var(--text-caption);
  color: var(--ink-3);
  text-wrap: balance;
}

.trend-category {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-2);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trend-frame {
  width: 100%;
  height: 72px;
  cursor: pointer;
  touch-action: pan-y;
}

svg {
  display: block;
  overflow: visible;
}

.trend-area {
  fill: var(--ink);
  opacity: 0.05;
}

.trend-line {
  fill: none;
  stroke: var(--meter-fill);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.trend-alert {
  stroke: var(--ink-3);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.7;
}

.trend-cross {
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.trend-dot {
  fill: var(--ink);
  stroke: var(--surface);
  stroke-width: 2;
}

.trend-text {
  fill: var(--ink-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.trend-text.strong {
  fill: var(--ink);
  font-weight: 600;
}

.trend-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-1);
  font-size: var(--text-label);
  color: var(--ink-3);
}

.trend-key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  text-wrap: balance;
}

.dash {
  display: inline-block;
  width: 14px;
  border-top: 1px dashed var(--ink-3);
}
</style>
