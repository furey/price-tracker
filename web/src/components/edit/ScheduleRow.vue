<script setup>
import { computed } from 'vue'
import { timeZoneLabel } from '../../format.js'
import { useInvalid } from '../../formContext.js'
import { DAYS, PRESETS, buildCron, describeSchedule } from '../../schedulePresets.js'
import FieldError from './FieldError.vue'

const props = defineProps({
  row: { type: Object, required: true },
  path: { type: String, required: true },
  idPrefix: { type: String, required: true },
  removable: { type: Boolean, default: true }
})

const emit = defineEmits(['remove'])

const invalid = useInvalid()

const showsSecondTime = computed(() => props.row.preset === 'twice-daily')

const usesTimes = computed(() => props.row.preset !== 'custom')

const preview = computed(() => {
  const cron = buildCron(props.row)
  if (!cron) return ''
  return describeSchedule({ cron, from: props.row.from, until: props.row.until })
})

const changePreset = (preset) => {
  if (preset === 'custom' && props.row.preset !== 'custom') {
    props.row.cron = buildCron(props.row) ?? props.row.cron
  }
  props.row.preset = preset
}

const toggleDay = (value) => {
  const days = props.row.days
  props.row.days = days.includes(value) ? days.filter((day) => day !== value) : [...days, value]
}

const fieldId = (name) => `${props.idPrefix}-${name}`
</script>

<template>
  <div class="row-item schedule-row">
    <div class="schedule-grid">
      <div class="field">
        <label :for="fieldId('preset')">Repeat</label>
        <select
          :id="fieldId('preset')"
          :value="row.preset"
          :aria-invalid="invalid(path)"
          @change="changePreset($event.target.value)"
        >
          <option v-for="preset in PRESETS" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </select>
      </div>
      <div v-if="usesTimes" class="field">
        <label :for="fieldId('time-1')">{{ showsSecondTime ? 'First time' : 'Time' }}</label>
        <input :id="fieldId('time-1')" v-model="row.times[0]" type="time" step="300" />
      </div>
      <div v-if="showsSecondTime" class="field">
        <label :for="fieldId('time-2')">Second time</label>
        <input :id="fieldId('time-2')" v-model="row.times[1]" type="time" step="300" />
      </div>
      <div v-if="row.preset === 'custom'" class="field wide">
        <label :for="fieldId('cron')">Cron pattern</label>
        <input
          :id="fieldId('cron')"
          v-model.trim="row.cron"
          class="num"
          type="text"
          spellcheck="false"
          placeholder="45 7 * * 2,5"
          :aria-invalid="invalid(path)"
        />
        <p class="hint">Minute, hour, day of month, month, weekday. {{ timeZoneLabel() }}.</p>
      </div>
    </div>
    <div v-if="row.preset === 'days'" class="chips" role="group" aria-label="Days of the week">
      <button
        v-for="day in DAYS"
        :key="day.value"
        class="chip"
        type="button"
        :aria-pressed="row.days.includes(day.value)"
        @click="toggleDay(day.value)"
      >
        {{ day.short }}
      </button>
    </div>
    <div class="schedule-grid">
      <div class="field">
        <label :for="fieldId('from')">Start date</label>
        <input :id="fieldId('from')" v-model="row.from" type="date" />
        <p class="hint">Blank starts now.</p>
      </div>
      <div class="field">
        <label :for="fieldId('until')">Stop date</label>
        <input :id="fieldId('until')" v-model="row.until" type="date" />
        <p class="hint">Checks stop at the start of this day. Blank never stops.</p>
      </div>
    </div>
    <FieldError :path="path" />
    <FieldError :path="`${path}.from`" />
    <FieldError :path="`${path}.until`" />
    <div class="row-foot">
      <span class="muted small">{{ preview }}</span>
      <button v-if="removable" class="btn link" type="button" @click="emit('remove')">
        Remove schedule
      </button>
    </div>
  </div>
</template>
