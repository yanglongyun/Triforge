<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-40" @click.self="$emit('close')">
      <div
        class="absolute rounded-lg border border-nt-divider bg-white p-2 shadow-2xl"
        :style="pos"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  open:   { type: Boolean, default: false },
  // 可以是 HTMLElement(推荐,resize/scroll 自动跟随)
  // 也可以是 rect-like {top, left, bottom, right, width, height}(静态快照)
  anchor: { type: Object, default: null },
  width:  { type: Number, default: 360 },
})
defineEmits(['close'])

// 让 pos 在 resize / scroll 时自动重算
const tick = ref(0)
let raf = null
const bump = () => {
  if (raf != null) return
  raf = requestAnimationFrame(() => { raf = null; tick.value++ })
}

const startListening = () => {
  window.addEventListener('resize', bump, { passive: true })
  // capture 模式才能听到内部滚动容器的 scroll
  window.addEventListener('scroll', bump, { passive: true, capture: true })
}
const stopListening = () => {
  window.removeEventListener('resize', bump)
  window.removeEventListener('scroll', bump, { capture: true })
}

watch(() => props.open, (open) => {
  if (open) { bump(); startListening() }
  else stopListening()
}, { immediate: true })

onUnmounted(stopListening)

const currentRect = computed(() => {
  // 依赖 tick,resize/scroll 触发时重算
  // eslint-disable-next-line no-unused-expressions
  tick.value
  const a = props.anchor
  if (!a) return null
  if (typeof Element !== 'undefined' && a instanceof Element) return a.getBoundingClientRect()
  return a
})

const pos = computed(() => {
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 800
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600
  const gutter = 8
  const width  = Math.min(props.width, vw - gutter * 2)

  const r = currentRect.value
  if (!r) {
    return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: `${width}px` }
  }

  const margin  = 6
  const maxLeft = vw - width - gutter
  const left    = Math.max(gutter, Math.min(r.left, maxLeft))
  const top     = (r.bottom + margin + 300 > vh)
    ? Math.max(gutter, r.top - margin - 8)
    : r.bottom + margin

  return { top: `${top}px`, left: `${left}px`, width: `${width}px` }
})
</script>
