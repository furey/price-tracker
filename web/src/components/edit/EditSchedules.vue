<script setup>
import { computed } from 'vue'
import { formatDateTime, timeZoneLabel } from '../../format.js'
import {
  buildSchedule, parseSchedule, presetProblem, regionTimeZone, slotCount, upcomingSlots
} from '../../schedulePresets.js'
import ScheduleRow from './ScheduleRow.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  off: { type: Boolean, required: true },
  title: { type: String, required: true },
  path: { type: String, required: true },
  countLabel: { type: String, required: true },
  offText: { type: String, required: true }
})

const emit = defineEmits(['update:off'])

const usable = computed(() => props.rows
  .filter((row) => !presetProblem(row))
  .map(buildSchedule))

const upcoming = computed(() => (props.off ? [] : upcomingSlots({ schedules: usable.value })))

const monthCount = computed(() => (props.off ? 0 : slotCount({ schedules: usable.value })))

const addRow = () => {
  props.rows.push(parseSchedule({ cron: '30 7 * * *', tz: regionTimeZone() }))
  emit('update:off', false)
}

const removeRow = (index) => {
  props.rows.splice(index, 1)
  if (props.rows.length === 0) emit('update:off', true)
}

const setOff = (value) => {
  if (!value && props.rows.length === 0) props.rows.push(parseSchedule({ cron: '30 7 * * *' }))
  emit('update:off', value)
}
</script>

<template>
  <div class="schedule-block">
    <div class="block-head">
      <h3>{{ title }}</h3>
      <div class="segmented" role="group" :aria-label="`${title} on or off`">
        <button type="button" :aria-pressed="!off" @click="setOff(false)">On</button>
        <button type="button" :aria-pressed="off" @click="setOff(true)">Off</button>
      </div>
    </div>
    <p v-if="off" class="muted small">{{ offText }}</p>
    <template v-else>
      <ScheduleRow
        v-for="(row, index) in rows"
        :key="index"
        :row="row"
        :path="`${path}[${index}]`"
        :id-prefix="`${path}-${index}`"
        @remove="removeRow(index)"
      />
      <button class="btn secondary small" type="button" @click="addRow">Add a schedule</button>
      <p class="hint muted small">
        Add a second schedule to change pace on a date, for example daily until a sale ends,
        then twice a week. All times are {{ timeZoneLabel() }}.
      </p>
      <div class="preview">
        <div>
          <span class="label">Next 3 checks</span>
          <ul v-if="upcoming.length" class="plain-list num">
            <li v-for="slot in upcoming" :key="slot.getTime()">{{ formatDateTime(slot) }}</li>
          </ul>
          <p v-else class="muted small">None scheduled.</p>
        </div>
        <div>
          <span class="label">Next 30 days</span>
          <p><span class="num big-number">{{ monthCount }}</span> {{ countLabel }}</p>
        </div>
      </div>
    </template>
  </div>
</template>
