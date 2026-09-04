<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3"
    :style="{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }"
  >
    <div class="pointer-events-auto flex items-center gap-0.5 rounded-full border border-nt-divider bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur">
      <!-- block types -->
      <button
        type="button"
        class="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-bold text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="标题 1"
        @mousedown.prevent
        @click="exec('formatBlock', 'H1')"
      >H1</button>
      <button
        type="button"
        class="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="标题 2"
        @mousedown.prevent
        @click="exec('formatBlock', 'H2')"
      >H2</button>
      <button
        type="button"
        class="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-medium text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="标题 3"
        @mousedown.prevent
        @click="exec('formatBlock', 'H3')"
      >H3</button>
      <button
        type="button"
        class="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="正文"
        @mousedown.prevent
        @click="exec('formatBlock', 'DIV')"
      >正文</button>

      <span class="mx-1 h-5 w-px bg-nt-divider" />

      <!-- inline -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="加粗 (⌘B)"
        @mousedown.prevent
        @click="exec('bold')"
      >B</button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full text-sm italic text-nt-muted hover:bg-nt-hover hover:text-nt"
        title="斜体 (⌘I)"
        @mousedown.prevent
        @click="exec('italic')"
      >I</button>
    </div>
  </div>
</template>

<script setup>
/** 底部浮动工具条。按钮全部 @mousedown.prevent —— 不然点它会先夺走选区,命令就落空了。 */
function exec(cmd, arg) {
  document.execCommand(cmd, false, arg || null)
}
</script>
