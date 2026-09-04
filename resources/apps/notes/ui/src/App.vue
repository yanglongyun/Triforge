<template>
  <div class="min-h-dvh bg-white">
    <Cover v-if="active?.cover" :cover="active.cover" @update="(v) => patch({ cover: v || '' })" />

    <main class="mx-auto w-full max-w-3xl px-4 pt-6 pb-32 md:px-12 md:pt-10">
      <div v-if="!tree" class="py-10 text-sm text-nt-soft">加载中…</div>

      <template v-else-if="active">
        <Breadcrumb :items="trail" @open="open" />

        <div class="mt-4">
          <button
            v-if="active.icon"
            ref="iconBtn"
            type="button"
            class="flex h-[78px] w-[78px] items-center justify-center rounded-md text-[66px] leading-none hover:bg-nt-hover"
            @click="openEmoji"
          >{{ active.icon }}</button>
        </div>

        <div class="mt-2 flex items-center gap-1 text-nt-soft">
          <button
            v-if="!active.icon"
            ref="iconBtn"
            type="button"
            class="rounded px-1.5 py-1 text-sm hover:bg-nt-hover hover:text-nt-muted"
            @click="openEmoji"
          >😀 添加图标</button>
          <button
            v-if="!active.cover"
            ref="coverBtn"
            type="button"
            class="rounded px-1.5 py-1 text-sm hover:bg-nt-hover hover:text-nt-muted"
            @click="openCover"
          >🏞️ 添加封面</button>
          <button
            ref="manageBtn"
            type="button"
            class="rounded px-1.5 py-1 text-sm hover:bg-nt-hover hover:text-nt-muted"
            @click="manageOpen = true; manageAnchor = $refs.manageBtn"
          >⚙️ {{ active.kind === 'folder' ? '管理笔记本' : '管理笔记' }}</button>
        </div>

        <input
          v-model="title"
          placeholder="无标题"
          class="mt-2 w-full border-0 bg-transparent py-1 text-3xl font-bold leading-tight tracking-tight text-nt outline-none placeholder:text-nt-hint md:text-[40px]"
          @input="scheduleTitle"
        />

        <!-- 笔记有正文没有子页,笔记本有子页没有正文 —— 这套模型的全部意义就在这一行 -->
        <ContentEditor
          v-if="active.kind === 'note'"
          class="mt-4" :value="html" placeholder="开始写点什么…" @update:value="onContent"
        />
        <ChildList v-else class="mt-6" :items="active.children" @open="open" @add="addChild" />
      </template>

      <ChildList v-else :items="[]" @add="addRoot" />
    </main>

    <EmojiPicker :open="emojiOpen" :anchor="emojiAnchor"
                 @pick="(v) => { patch({ icon: v || '' }); emojiOpen = false }"
                 @close="emojiOpen = false" />
    <CoverPicker :open="coverOpen" :anchor="coverAnchor"
                 @pick="(v) => { patch({ cover: v || '' }); coverOpen = false }"
                 @close="coverOpen = false" />

    <Popover :open="manageOpen" :anchor="manageAnchor" :width="180" @close="manageOpen = false">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-nt hover:bg-nt-danger-bg hover:text-nt-danger"
        @click="remove"
      ><span>🗑</span> {{ active?.kind === 'folder' ? '删除笔记本' : '删除笔记' }}</button>
    </Popover>

    <EditorToolbar v-if="active?.kind === 'note'" />

    <div v-if="error"
         class="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-nt-danger bg-white px-3 py-2 text-sm shadow-lg">
      <span>{{ error }}</span>
      <button type="button" class="text-nt-soft hover:text-nt" @click="error = ''">✕</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import Breadcrumb from './components/Breadcrumb.vue';
import ChildList from './components/ChildList.vue';
import ContentEditor from './components/ContentEditor.vue';
import Cover from './components/Cover.vue';
import CoverPicker from './components/CoverPicker.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import EmojiPicker from './components/EmojiPicker.vue';
import Popover from './components/Popover.vue';
import { api } from './lib/api';
import { htmlToMd, mdToHtml } from './lib/markdown';

const SAVE_DELAY = 500;

const tree = ref(null);
const activeId = ref(null);
const html = ref('');
const title = ref('');
const error = ref('');

const emojiOpen = ref(false); const emojiAnchor = ref(null);
const coverOpen = ref(false); const coverAnchor = ref(null);
const manageOpen = ref(false); const manageAnchor = ref(null);
const iconBtn = ref(null); const coverBtn = ref(null);

const findPage = (nodes, id) => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findPage(node.children, id);
    if (hit) return hit;
  }
  return null;
};
const trailTo = (nodes, id, acc = []) => {
  for (const node of nodes) {
    const next = [...acc, node];
    if (node.id === id) return next;
    const hit = trailTo(node.children, id, next);
    if (hit) return hit;
  }
  return null;
};

const active = computed(() => (tree.value && activeId.value != null ? findPage(tree.value, activeId.value) : null));
const trail = computed(() => (tree.value && activeId.value != null ? trailTo(tree.value, activeId.value) ?? [] : []));

const guard = async (fn) => {
  try { await fn(); await refresh(); }
  catch (e) { error.value = e?.message || '操作失败'; }
};

async function refresh() {
  tree.value = await api.tree();
  if (activeId.value == null || !findPage(tree.value, activeId.value)) {
    activeId.value = tree.value[0]?.id ?? null;
  }
}

async function open(id) {
  // 面包屑的「首页」传 null:回到根 —— 就是种在库里那个「首页」笔记本
  activeId.value = id ?? tree.value?.[0]?.id ?? null;
}

// 切页时把正文换掉。**先把上一页没落盘的刷掉** —— 否则 500ms 窗口里切走就丢了
watch(activeId, async (id, previous) => {
  if (previous != null) flushBody();
  if (id == null) { html.value = ''; title.value = ''; return; }
  title.value = active.value?.title === '无标题' ? '' : (active.value?.title ?? '');
  // 笔记本没有正文,别去要 —— 服务端会拒,白拿一个错
  html.value = active.value?.kind === 'note' ? mdToHtml(await api.body(id).catch(() => '')) : '';
});

/* ── 正文:停手 500ms 落盘 ───────────────────────────── */
let bodyTimer = null;
let pendingMd = null;

function flushBody() {
  if (bodyTimer) { clearTimeout(bodyTimer); bodyTimer = null; }
  if (pendingMd === null) return;
  const [id, md] = pendingMd;
  pendingMd = null;
  void api.saveBody(id, md).catch((e) => { error.value = e?.message || '保存失败'; });
}

function onContent(nextHtml) {
  if (activeId.value == null) return;
  pendingMd = [activeId.value, htmlToMd(nextHtml)];
  if (bodyTimer) clearTimeout(bodyTimer);
  bodyTimer = setTimeout(flushBody, SAVE_DELAY);
}

/* ── 标题:同样防抖,改完刷新树,子页列表和面包屑要跟着变 ── */
let titleTimer = null;
function scheduleTitle() {
  if (titleTimer) clearTimeout(titleTimer);
  titleTimer = setTimeout(() => {
    const id = activeId.value;
    if (id == null) return;
    void guard(() => api.update(id, { title: title.value.trim() }));
  }, SAVE_DELAY);
}

const patch = (p) => guard(() => api.update(activeId.value, p));
const addChild = (kind) => guard(async () => {
  const p = await api.create({ parentId: activeId.value, kind });
  activeId.value = p.id;
});
const addRoot = (kind) => guard(async () => { const p = await api.create({ kind }); activeId.value = p.id; });

function remove() {
  manageOpen.value = false;
  const page = active.value;
  if (!page) return;
  const kids = page.children.length;
  if (!confirm(`删除「${page.title}」${kids ? `及其 ${kids} 个子页` : ''}?`)) return;
  const parent = trail.value[trail.value.length - 2] ?? null;
  void guard(async () => { await api.remove(page.id); activeId.value = parent?.id ?? null; });
}

function openEmoji() { emojiAnchor.value = iconBtn.value; emojiOpen.value = true; }
function openCover() { coverAnchor.value = coverBtn.value; coverOpen.value = true; }
/* ── SSE:树是唯一真相,收到通知就重取,不做增量合并 ── */
let source = null;
onMounted(() => {
  void refresh().catch((e) => { error.value = e?.message || '加载失败'; });
  source = new EventSource('/api/events');
  source.addEventListener('changed', () => { void refresh().catch(() => {}); });
  window.addEventListener('beforeunload', flushBody);
});
onBeforeUnmount(() => {
  source?.close();
  window.removeEventListener('beforeunload', flushBody);
  flushBody();
});
</script>
