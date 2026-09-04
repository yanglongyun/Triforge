<template>
  <div class="w-full">
    <ul v-if="items.length" class="flex flex-col">
      <li v-for="node in items" :key="node.id">
        <button
          type="button"
          class="flex min-h-7 w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-nt-hover"
          @click="$emit('open', node.id)"
        >
          <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base">
            {{ node.icon || (node.kind === 'folder' ? '📁' : '📄') }}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-nt">
            {{ node.title || '无标题' }}<span v-if="node.kind === 'folder'" class="text-nt-soft"> /</span>
          </span>
        </button>
      </li>
    </ul>

    <div v-else class="py-6 text-sm text-nt-soft">还没有内容。</div>

    <div class="mt-3 flex flex-col gap-0.5">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm text-nt-muted hover:bg-nt-hover hover:text-nt"
        @click="$emit('add', 'folder')"
      >
        <span class="inline-flex h-5 w-5 items-center justify-center text-base">＋</span>
        <span>新建笔记本</span>
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm text-nt-muted hover:bg-nt-hover hover:text-nt"
        @click="$emit('add', 'note')"
      >
        <span class="inline-flex h-5 w-5 items-center justify-center text-base">＋</span>
        <span>新建笔记</span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({ items: { type: Array, default: () => [] } })
defineEmits(['open', 'add'])
</script>
