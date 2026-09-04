<template>
  <div class="relative">
    <div
      v-if="showPlaceholder"
      class="pointer-events-none absolute left-0 top-0 text-base leading-7 text-nt-hint"
    >
      {{ placeholder }}
    </div>
    <div
      ref="editorRef"
      contenteditable="true"
      class="note-editor min-h-[60vh] w-full whitespace-pre-wrap break-words text-base leading-7 text-nt outline-none
             [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md
             [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight
             [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:leading-tight
             [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-xl  [&_h3]:font-semibold
             [&_strong]:font-bold [&_b]:font-bold
             [&_em]:italic [&_i]:italic"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    />

  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { contentToHtml } from '../lib/html'
import { mdToHtml } from '../lib/markdown'

const props = defineProps({
  value:       { type: String, default: '' },
  placeholder: { type: String, default: '开始写点什么…' },
})
const emit = defineEmits(['update:value', 'input'])

const editorRef   = ref(null)

// IME 输入期间不要 emit,否则中文/日文打到一半会触发 prop 来回同步
let isComposing = false
// 最近一次我们 emit 出去的 HTML。父组件把它原样 setBack 时,跳过 resync,
// 避免触发 innerHTML 重赋值 → 光标被拉回开头(移动端尤其容易出)
let lastEmitted = null

const showPlaceholder = computed(() => {
  const v = props.value || ''
  if (!v.trim()) return true
  const stripped = v.replace(/<br\s*\/?>/gi, '').replace(/<div>\s*<\/div>/gi, '').trim()
  return stripped === ''
})

function syncFromProp() {
  const el = editorRef.value
  if (!el) return
  const nextHtml = contentToHtml(props.value || '')
  if (el.innerHTML === nextHtml) return
  // 父组件把我们刚 emit 的值原样送回来 → 跳过,保留光标
  if (props.value === lastEmitted) return
  // 当前 DOM 内容跟目标的语义相同(只是没包 <div>),别重写
  if (contentToHtml(el.innerHTML || '') === nextHtml) return
  el.innerHTML = nextHtml
}

onMounted(syncFromProp)
watch(() => props.value, syncFromProp)

function emitChange() {
  const el = editorRef.value
  if (!el) return
  const html = el.innerHTML
  lastEmitted = html
  emit('update:value', html)
  emit('input', html)
}

function onCompositionStart() { isComposing = true }
function onCompositionEnd()   { isComposing = false; emitChange() }

// ───────── 键盘快捷键:Cmd/Ctrl+B / Cmd/Ctrl+I ─────────
function onKeydown(e) {
  const ctrl = e.metaKey || e.ctrlKey
  if (!ctrl || e.altKey) return
  const k = e.key.toLowerCase()
  if (k === 'b') { e.preventDefault(); document.execCommand('bold');   emitChange() }
  if (k === 'i') { e.preventDefault(); document.execCommand('italic'); emitChange() }
}

// ───────── 行首 markdown 快捷键:#/##/### + 空格 → H1/H2/H3 ─────────
const BLOCK_TAGS = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE'])

function enclosingBlock(node, root) {
  let el = node.nodeType === 1 ? node : node.parentElement
  while (el && el !== root) {
    if (BLOCK_TAGS.has(el.tagName)) return el
    el = el.parentElement
  }
  return null
}

function tryMarkdownHeading() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const root = editorRef.value
  if (!root) return false

  const block = enclosingBlock(sel.anchorNode, root) || root
  const text  = block.textContent || ''
  const m = text.match(/^(#{1,3}) $/)
  if (!m) return false

  const level = m[1].length
  // 清空当前 block 内容,再 formatBlock 成 H1/H2/H3
  while (block.firstChild) block.removeChild(block.firstChild)

  // 光标要落在刚被清空的 block 里
  const r = document.createRange()
  r.setStart(block, 0)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)

  document.execCommand('formatBlock', false, `H${level}`)
  return true
}

function onInput(e) {
  if (isComposing) return   // IME 组合阶段,等 compositionend
  if (e.inputType === 'insertText' && e.data === ' ') {
    if (tryMarkdownHeading()) {
      emitChange()
      return
    }
  }
  emitChange()
}

/** 只把明显带 Markdown 语法的文本当 Markdown,普通多行文本不做猜测。 */
function looksLikeMarkdown(text) {
  return /(^|\n)\s{0,3}(#{1,6}\s|(?:[-*+]\s+|\d+[.)]\s+)|>\s|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*$)/m.test(text)
    || /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m.test(text)
    || /(^|[^\\])(?:\*\*|__|~~|`)[^\n]+(?:\*\*|__|~~|`)/.test(text)
    || /\[[^\]]+\]\([^\s)]+(?:\s+"[^"]*")?\)/.test(text)
    || /(^|\n)\s*[-*+]\s+\[[ xX]\]\s+/m.test(text)
}

/**
 * Markdown 粘贴为所见即所得内容;普通文本仍按纯文本插入。
 * 剪贴板自带的 HTML 不采用,避免把外部网页的字体、颜色和内联样式带进正文。
 */
function onPaste(e) {
  const cd = e.clipboardData
  if (!cd) return
  e.preventDefault()
  const text = cd.getData('text/plain') || ''
  if (text) {
    if (looksLikeMarkdown(text)) document.execCommand('insertHTML', false, mdToHtml(text))
    else document.execCommand('insertText', false, text)
    nextTick(emitChange)
  }
}

</script>
