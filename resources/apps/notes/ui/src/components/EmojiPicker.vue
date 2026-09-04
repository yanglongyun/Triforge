<template>
  <Popover :open="open" :anchor="anchor" :width="360" @close="$emit('close')">
    <div class="flex items-center gap-2 border-b border-nt-divider px-2 pb-2">
      <input
        v-model="q"
        type="text"
        placeholder="搜索 emoji,中文 / 英文都行…"
        class="flex-1 rounded-md bg-nt-hover px-2 py-1 text-sm outline-none placeholder:text-nt-hint focus:bg-nt-hover-strong"
      />
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-nt-muted hover:bg-nt-hover hover:text-nt disabled:opacity-40"
        :disabled="!data.all.length"
        @click="$emit('pick', pickRandomEmoji(data.all))"
      >随机</button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-nt-muted hover:bg-nt-hover hover:text-nt"
        @click="$emit('pick', null)"
      >清除</button>
    </div>

    <div class="mt-2 max-h-72 overflow-y-auto">
      <div v-if="loading" class="py-8 text-center text-sm text-nt-soft">加载中…</div>
      <div v-else-if="error" class="py-8 text-center text-sm text-nt-danger">{{ error }}</div>

      <template v-else-if="q">
        <div v-if="filtered.length" class="grid grid-cols-8 gap-0.5">
          <button
            v-for="item in filtered"
            :key="`s-${item.emoji}`"
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-nt-hover"
            :title="item.label"
            @click="$emit('pick', item.emoji)"
          >{{ item.emoji }}</button>
        </div>
        <div v-else class="py-8 text-center text-xs text-nt-soft">没找到匹配的 emoji</div>
      </template>

      <template v-else>
        <div v-for="group in data.groups" :key="group.key" class="mb-2">
          <div class="px-1 pb-1 text-xs text-nt-soft">{{ group.label }}</div>
          <div class="grid grid-cols-8 gap-0.5">
            <button
              v-for="item in group.list"
              :key="`${group.key}-${item.emoji}`"
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-nt-hover"
              :title="item.label"
              @click="$emit('pick', item.emoji)"
            >{{ item.emoji }}</button>
          </div>
        </div>
      </template>
    </div>
  </Popover>
</template>

<script setup>
import { ref, shallowRef, computed, watch } from 'vue'
import Popover from './Popover.vue'
import { loadEmojiData, pickRandomEmoji } from '../lib/emoji'

const props = defineProps({
  open:   { type: Boolean, default: false },
  anchor: { type: Object,  default: null },
})
defineEmits(['pick', 'close'])

const q       = ref('')
const loading = ref(false)
const error   = ref('')
// 1900+ emoji,shallowRef 避免无谓的深度响应
const data    = shallowRef({ groups: [], all: [] })

watch(() => props.open, async (v) => {
  if (!v) return
  q.value = ''
  if (data.value.all.length) return
  loading.value = true
  error.value   = ''
  try {
    data.value = await loadEmojiData()
  } catch (e) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
})

// 搜索:label / tags / emoji 字符任一匹配。label 命中排在 tag 命中前。
const filtered = computed(() => {
  const term = q.value.trim().toLowerCase()
  if (!term) return []
  const labelHits = []
  const tagHits   = []
  for (const item of data.value.all) {
    if (item.emoji === term) { labelHits.push(item); continue }
    if (item.label.toLowerCase().includes(term)) { labelHits.push(item); continue }
    if (item.tags.some((t) => t.toLowerCase().includes(term))) tagHits.push(item)
  }
  return [...labelHits, ...tagHits].slice(0, 200)
})
</script>
