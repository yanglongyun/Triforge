<template>
  <nav class="flex flex-wrap items-center gap-0.5 text-sm text-nt-muted">
    <template v-for="(item, idx) in items" :key="item.id">
      <span v-if="idx > 0" class="select-none px-0.5 text-nt-soft">/</span>

      <button
        v-if="idx < items.length - 1"
        type="button"
        class="flex max-w-64 items-center gap-1 truncate rounded-sm px-1.5 py-0.5 transition-colors hover:bg-nt-hover hover:text-nt"
        @click="$emit('open', item.id)"
      >
        <span v-if="item.icon" class="inline-flex h-4 w-4 items-center justify-center">{{ item.icon }}</span>
        <span class="truncate">{{ item.title || '无标题' }}</span>
      </button>

      <!-- 末端是当前页,不做成按钮 —— 点自己没有意义 -->
      <span v-else class="flex max-w-64 items-center gap-1 truncate px-1.5 py-0.5 text-nt">
        <span v-if="item.icon" class="inline-flex h-4 w-4 items-center justify-center">{{ item.icon }}</span>
        <span class="truncate">{{ item.title || '无标题' }}</span>
      </span>
    </template>
  </nav>
</template>

<script setup>
defineProps({ items: { type: Array, default: () => [] } })
defineEmits(['open'])
</script>
