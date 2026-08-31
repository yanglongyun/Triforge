<template>
  <Popover :open="open" :anchor="anchor" :width="380" @close="$emit('close')">
    <div class="px-1 pb-2 text-xs text-nt-soft">预置</div>
    <div class="grid grid-cols-2 gap-2">
      <button
        v-for="p in COVER_PRESETS"
        :key="p.key"
        type="button"
        class="h-16 w-full overflow-hidden rounded-md border border-nt-divider bg-nt-hover bg-cover bg-center"
        :style="{ backgroundImage: `url(${JSON.stringify(p.url)})` }"
        :title="p.label"
        @click="$emit('pick', p.key)"
      />
    </div>

    <div class="mt-3 border-t border-nt-divider pt-2">
      <div class="px-1 pb-1 text-xs text-nt-soft">自定义图片 URL</div>
      <form class="flex items-center gap-2" @submit.prevent="submitUrl">
        <input
          v-model="url"
          type="url"
          placeholder="https://…"
          class="flex-1 rounded-md bg-nt-hover px-2 py-1 text-sm outline-none placeholder:text-nt-hint focus:bg-nt-hover-strong"
        />
        <button
          type="submit"
          class="rounded-md px-2 py-1 text-xs text-nt-muted hover:bg-nt-hover hover:text-nt"
          :disabled="!url.trim()"
        >
          使用
        </button>
      </form>
    </div>

    <div class="mt-2 flex justify-end">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-nt-muted hover:bg-nt-hover hover:text-nt"
        @click="$emit('pick', null)"
      >
        移除封面
      </button>
    </div>
  </Popover>
</template>

<script setup>
import { ref, watch } from 'vue'
import Popover from './Popover.vue'
import { COVER_PRESETS } from '../lib/cover'

const props = defineProps({
  open:   { type: Boolean, default: false },
  anchor: { type: Object,  default: null },
})
const emit = defineEmits(['pick', 'close'])

const url = ref('')

watch(() => props.open, (v) => { if (v) url.value = '' })

function submitUrl() {
  const v = url.value.trim()
  if (v) emit('pick', v)
}
</script>
