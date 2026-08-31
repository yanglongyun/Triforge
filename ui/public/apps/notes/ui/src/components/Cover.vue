<template>
  <div v-if="cover">
    <button
      ref="coverEl"
      type="button"
      class="block h-[30vh] min-h-40 w-full overflow-hidden border-0 bg-nt-hover p-0"
      :style="imageStyle"
      @click="openMenu"
    />

    <!-- 点击封面后出现的小菜单 -->
    <Popover :open="menuOpen" :anchor="menuAnchor" :width="180" @close="menuOpen = false">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-nt hover:bg-nt-hover"
        @click="onChange"
      >
        <span>🏞️</span> 更换封面
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-nt hover:bg-nt-hover"
        @click="onRemove"
      >
        <span>🗑</span> 移除封面
      </button>
    </Popover>

    <!-- 预置/URL picker(用"更换封面"入口) -->
    <CoverPicker
      :open="pickerOpen"
      :anchor="pickerAnchor"
      @pick="onPick"
      @close="pickerOpen = false"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import CoverPicker from './CoverPicker.vue'
import Popover from './Popover.vue'
import { coverStyle } from '../lib/cover'

const props = defineProps({
  cover: { type: String, default: null },
})
const emit = defineEmits(['update'])

const coverEl    = ref(null)
const menuOpen   = ref(false)
const menuAnchor = ref(null)
const pickerOpen = ref(false)
const pickerAnchor = ref(null)

const imageStyle = computed(() => coverStyle(props.cover) || {})

function openMenu(e) {
  // 锚点用点击位置,菜单紧贴鼠标一点,不然整条封面宽度会让菜单飞到右边
  menuAnchor.value = {
    left:   e.clientX,
    right:  e.clientX,
    top:    e.clientY,
    bottom: e.clientY,
  }
  menuOpen.value = true
}

function onChange() {
  pickerAnchor.value = menuAnchor.value
  menuOpen.value = false
  pickerOpen.value = true
}

function onRemove() {
  menuOpen.value = false
  emit('update', null)
}

function onPick(v) {
  pickerOpen.value = false
  emit('update', v)
}
</script>
