// 思维导图画布引擎:布局、渲染、动画、交互全部在此,持久化通过注入的 save 适配器完成。
// 数据模型与库一致:扁平 rows [{id, parent_id, text, side, sort_order, collapsed, created_at}]

const PALETTE = ['#6E5BF0', '#16989E', '#E55A8B', '#DF8E1D', '#3E7BEF', '#3F9D63']
const TG = 22 // 折叠钮圆心距卡片边缘的距离,与 style.css 里 .tg 的定位(±33px, 宽 22px)对应
const GX1 = 64, GX = 48, GY1 = 30, GY = 18 // 根/层横向间距,一级/深层纵向间距
const SVG_NS = 'http://www.w3.org/2000/svg'

// 连线往底色里调淡,重叠处颜色才不叠加。混的是 --panel 而不是写死的白,
// 这样墨夜主题下是往深色调,不会在暗背景上烧出一片亮线。
const light = (color) => `color-mix(in srgb, ${color} 55%, var(--panel))`
const stop = (el) => ['pointerdown', 'dblclick'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()))

import type { MindmapEngine, MindmapUI, SaveAdapter, Topic } from './types'

export function createMindmap({ viewport, world, svg, topics, save, ui }: {
  viewport: HTMLElement
  world: HTMLElement
  svg: SVGSVGElement
  topics: Topic[]
  save: SaveAdapter
  ui: MindmapUI
}): MindmapEngine {
  const rows = topics
  const meta = new Map() // id -> {n,parent,depth,side,color,visible}(退场中的节点保留旧条目直到动画结束)
  const els = new Map(), paths = new Map(), stubs = new Map(), cur = new Map(), meas = new Map()
  let sel = null, editing = null, lastTargets = new Map()
  const pan = { x: 0, y: 0 }
  let zoom = 1, rafId = 0

  const rootRow = () => rows.find((r) => !r.parent_id)
  const rowOf = (id) => rows.find((r) => r.id === id)
  const childrenOf = (id) => rows
    .filter((r) => r.parent_id === id)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
  /** 含自身的整棵子树 —— 删除和拖拽都要成批认这些 id */
  function subtreeIds(id) {
    const ids = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const t of rows) if (t.parent_id && ids.has(t.parent_id) && !ids.has(t.id)) { ids.add(t.id); changed = true }
    }
    return ids
  }

  /* ---------------- 元数据(整树遍历) ---------------- */
  function syncMeta() {
    meta.forEach((m) => { m.visible = false })
    const root = rootRow()
    if (!root) return
    const rootKids = childrenOf(root.id)
    const walk = (n, parent, depth, side, color, visible) => {
      meta.set(n.id, { n, parent, depth, side, color, visible })
      const kidsVisible = visible && (depth === 0 || !n.collapsed) // 根节点不参与折叠
      childrenOf(n.id).forEach((c) => {
        const s = depth === 0 ? (c.side || 'right') : side
        const col = depth === 0 ? PALETTE[Math.max(0, rootKids.indexOf(c)) % PALETTE.length] : color
        walk(c, n, depth + 1, s, col, kidsVisible)
      })
    }
    walk(root, null, 0, 'root', PALETTE[0], true)
  }
  const visibleList = () => [...meta.values()].filter((m) => m.visible)

  /* ---------------- 节点 DOM ---------------- */
  function renderNode(el, m) {
    const n = m.n, isRoot = !n.parent_id
    el.style.setProperty('--c', m.color)
    el.className = ['node', `side-${m.side}`, isRoot && 'root', m.depth === 1 && 'depth1',
      sel === n.id && 'sel'].filter(Boolean).join(' ')
    if (editing === n.id) return
    el.replaceChildren()
    const txt = document.createElement('span')
    txt.className = 'txt'; txt.textContent = n.text
    el.appendChild(txt)
    const kids = childrenOf(n.id)
    if (kids.length && !isRoot) {
      const tg = document.createElement('button')
      tg.className = 'tg' + (n.collapsed ? ' on' : '')
      tg.innerHTML = n.collapsed ? String(kids.length) : '<svg viewBox="0 0 16 16"><path d="M4.5 8h7"/></svg>'
      tg.title = n.collapsed ? `展开 ${kids.length} 个子主题` : '收起分支'
      stop(tg)
      tg.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(n) })
      el.appendChild(tg)
    }
  }

  /* ---------------- 布局 ---------------- */
  function layoutTargets() {
    const t = new Map()
    const root = rootRow()
    if (!root) return t
    const kidsOf = (n) => (!n.parent_id || !n.collapsed) ? childrenOf(n.id) : []
    const sh = (n) => {
      const kids = kidsOf(n), h = meas.get(n.id)?.h || 40
      if (!kids.length) return h
      return Math.max(h, kids.reduce((s, c) => s + sh(c), 0) + (kids.length - 1) * GY)
    }
    t.set(root.id, { x: 0, y: 0 })
    const place = (n, x, y, dir) => {
      t.set(n.id, { x, y })
      const kids = kidsOf(n)
      if (!kids.length) return
      const tot = kids.reduce((s, c) => s + sh(c), 0) + (kids.length - 1) * GY
      let cursor = y - tot / 2
      for (const c of kids) {
        const h = sh(c), cy = cursor + h / 2
        const cx = x + dir * ((meas.get(n.id)?.w || 100) / 2 + GX + (meas.get(c.id)?.w || 100) / 2)
        place(c, cx, cy, dir); cursor += h + GY
      }
    }
    for (const side of ['right', 'left']) {
      const dir = side === 'right' ? 1 : -1
      const group = childrenOf(root.id).filter((c) => (c.side || 'right') === side)
      if (!group.length) continue
      const tot = group.reduce((s, c) => s + sh(c), 0) + (group.length - 1) * GY1
      let cursor = -tot / 2
      for (const c of group) {
        const h = sh(c), cy = cursor + h / 2
        const cx = dir * ((meas.get(root.id)?.w || 140) / 2 + GX1 + (meas.get(c.id)?.w || 100) / 2)
        place(c, cx, cy, dir); cursor += h + GY1
      }
    }
    return t
  }

  /* ---------------- 连线 ---------------- */
  // 组织图画法:所有兄弟共用一条竖直主干,各自从主干上以小圆角拐出、水平接入。
  // 这样子节点再多也不会交错 —— 曲线各画各的时,它们从同一点出发必然叠在一起。
  // 主干贴着父节点走,子节点那侧留长一点,读起来层级更清楚。
  // fromToggle:父节点有折叠钮时从钮心出发,根节点从卡片边缘出发。
  function elbow(pc, c, dir, pw, cw, fromToggle) {
    const x1 = pc.x + dir * (pw / 2 + (fromToggle ? TG : 0))
    const x2 = c.x - dir * cw / 2
    const dy = c.y - pc.y
    const trunkX = x1 + dir * Math.min(22, Math.abs(x2 - x1) * .45)
    const r = Math.min(9, Math.abs(dy), Math.abs(x2 - trunkX))
    return r < 1
      ? `M ${x1} ${pc.y} L ${x2} ${c.y}` // 和父节点齐平,一条直线就够
      : `M ${x1} ${pc.y} L ${trunkX} ${pc.y} L ${trunkX} ${c.y - Math.sign(dy) * r}`
        + ` Q ${trunkX} ${c.y} ${trunkX + dir * r} ${c.y} L ${x2} ${c.y}`
  }

  // 拖动中不去拉长旧连线 —— 拖一根枝条就是把它摘下来,那条关系当场就不成立了,
  // 让它跟着手走等于在说"还挂在原来那儿"。改成:旧线直接断开,再用一条虚线
  // 预告它将要接到哪儿。没有落点时什么都不画,枝条就是悬空的。
  let preview = null
  function drawPreview() {
    if (!preview) {
      preview = document.createElementNS(SVG_NS, 'path')
      preview.setAttribute('fill', 'none')
      preview.setAttribute('stroke-linecap', 'round')
      preview.setAttribute('stroke-dasharray', '7 5')
      preview.setAttribute('stroke-width', 2.4)
      svg.appendChild(preview)
    }
    const target = drag?.moved ? drag.target : null
    if (!target) { preview.setAttribute('opacity', 0); return }
    const pc = cur.get(target), c = cur.get(drag.id)
    if (!pc || !c) { preview.setAttribute('opacity', 0); return }
    const dir = c.x >= pc.x ? 1 : -1 // 预告线跟着落点走,不看原来挂在哪半边
    const pw = meas.get(target)?.w || 100, cw = meas.get(drag.id)?.w || 100
    preview.style.stroke = meta.get(target)?.color || PALETTE[0]
    preview.setAttribute('d', elbow(pc, c, dir, pw, cw, Boolean(rowOf(target)?.parent_id)))
    preview.setAttribute('opacity', .85)
  }

  function drawEdges() {
    for (const [id, p] of paths) {
      const m = meta.get(id), par = m?.parent
      const c = cur.get(id), pc = par && cur.get(par.id)
      if (!m || !c || !pc) { p.setAttribute('opacity', 0); continue }
      if (drag?.moved && id === drag.id) { p.setAttribute('opacity', 0); continue } // 拖动中:这条关系正在被解除,见 drawPreview
      const dir = m.side === 'left' ? -1 : 1
      const pw = meas.get(par.id)?.w || 100, cw = meas.get(id)?.w || 100
      p.setAttribute('d', elbow(pc, c, dir, pw, cw, Boolean(par.parent_id)))
      p.setAttribute('opacity', Math.min(c.o ?? 1, pc.o ?? 1))
    }
    for (const [id, p] of stubs) { // 卡片 → 折叠钮 的短线
      const m = meta.get(id), c = cur.get(id)
      if (!m || !c) { p.setAttribute('opacity', 0); continue }
      const dir = m.side === 'left' ? -1 : 1
      const w = meas.get(id)?.w || 100
      p.setAttribute('d', `M ${c.x + dir * w / 2} ${c.y} L ${c.x + dir * (w / 2 + TG)} ${c.y}`)
      p.setAttribute('opacity', c.o ?? 1)
    }
    drawPreview()
  }

  /* ---------------- 同步(一切结构变化的入口) ---------------- */
  function syncView() {
    syncMeta()
    const vis = visibleList()
    for (const m of vis) {
      let el = els.get(m.n.id)
      if (!el) {
        el = document.createElement('div')
        const id = m.n.id
        el.addEventListener('pointerdown', (e) => onNodePointerDown(e, id))
        el.addEventListener('pointermove', onNodePointerMove)
        el.addEventListener('pointerup', onNodePointerUp)
        el.addEventListener('pointercancel', () => { if (endDrag()) syncView() })
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); beginEdit(id) })
        world.appendChild(el); els.set(m.n.id, el)
      }
      el.classList.remove('exit')
      renderNode(el, m)
      if (m.n.parent_id) {
        let p = paths.get(m.n.id)
        if (!p) {
          p = document.createElementNS(SVG_NS, 'path')
          p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round')
          svg.appendChild(p); paths.set(m.n.id, p)
        }
        p.style.stroke = light(m.color) // color-mix 只在 CSS 属性上解析,不能走 setAttribute
        p.setAttribute('stroke-width', m.depth === 1 ? 2.6 : 1.8)
      }
      if (m.n.parent_id && childrenOf(m.n.id).length) {
        let s = stubs.get(m.n.id)
        if (!s) {
          s = document.createElementNS(SVG_NS, 'path')
          s.setAttribute('fill', 'none'); s.setAttribute('stroke-linecap', 'round')
          svg.appendChild(s); stubs.set(m.n.id, s)
        }
        s.style.stroke = light(m.color)
        s.setAttribute('stroke-width', 1.8)
      }
    }
    for (const [id, s] of stubs) { // 失去子节点的清掉;收起动画中的保留随节点淡出
      const m = meta.get(id)
      const exiting = els.has(id) && m && !m.visible
      if (!(m?.visible && m.n.parent_id && childrenOf(id).length) && !exiting) { s.remove(); stubs.delete(id) }
    }
    for (const m of vis) { const el = els.get(m.n.id); meas.set(m.n.id, { w: el.offsetWidth, h: el.offsetHeight }) }
    lastTargets = layoutTargets()
    const exitIds = [...els.keys()].filter((id) => !meta.get(id)?.visible)
    exitIds.forEach((id) => els.get(id).classList.add('exit'))
    animate(lastTargets, exitIds)
    ui.onCount?.(rows.length)
  }

  /* ---------------- 动画 ---------------- */
  const nearest = (id, map) => { // 沿祖先链找最近的可用坐标
    let p = meta.get(id)?.parent
    while (p) { const v = map.get(p.id); if (v) return v; p = meta.get(p.id)?.parent }
    return null
  }
  /** 把一个坐标写到 DOM 上。动画每帧和拖拽跟手都走这里,写法只此一处。 */
  function placeEl(id, c) {
    const el = els.get(id)
    if (!el) return
    el.style.transform = `translate(${c.x}px,${c.y}px) translate(-50%,-50%) scale(${.72 + .28 * c.o})`
    el.style.opacity = c.o
  }
  function animate(targets, exitIds, skip) {
    const items = []
    for (const [id, t] of targets) {
      if (skip?.has(id)) continue
      let c = cur.get(id)
      if (!c) { const a = nearest(id, cur) || nearest(id, targets) || t; c = { x: a.x, y: a.y, o: 0 }; cur.set(id, c) }
      items.push({ id, fx: c.x, fy: c.y, fo: c.o ?? 1, tx: t.x, ty: t.y, to: 1 })
    }
    for (const id of exitIds) {
      const c = cur.get(id) || { x: 0, y: 0, o: 1 }
      const a = nearest(id, targets) || c
      items.push({ id, fx: c.x, fy: c.y, fo: c.o ?? 1, tx: a.x, ty: a.y, to: 0, remove: true })
    }
    cancelAnimationFrame(rafId)
    const t0 = performance.now(), D = 300
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3)
      for (const it of items) {
        const c = { x: it.fx + (it.tx - it.fx) * e, y: it.fy + (it.ty - it.fy) * e, o: it.fo + (it.to - it.fo) * e }
        cur.set(it.id, c)
        placeEl(it.id, c)
      }
      drawEdges()
      if (k < 1) rafId = requestAnimationFrame(step)
      else for (const it of items) if (it.remove) {
        els.get(it.id)?.remove(); paths.get(it.id)?.remove(); stubs.get(it.id)?.remove()
        els.delete(it.id); paths.delete(it.id); stubs.delete(it.id)
        cur.delete(it.id); meas.delete(it.id); meta.delete(it.id)
      }
    }
    rafId = requestAnimationFrame(step)
  }

  /* ---------------- 操作(乐观更新,失败回滚) ---------------- */
  function select(id) {
    sel = id
    els.forEach((el, i) => el.classList.toggle('sel', i === sel))
    ui.onSelection?.(sel)
  }

  function toggleCollapse(row) {
    row.collapsed = row.collapsed ? 0 : 1
    syncView()
    save.patch(row.id, { collapsed: !!row.collapsed }).catch(() => {
      row.collapsed = row.collapsed ? 0 : 1; syncView(); ui.onError?.('保存失败')
    })
  }

  function beginEdit(id, initial = null) {
    if (editing && editing !== id) commitEdit(true)
    const el = els.get(id), row = rowOf(id)
    if (!el || !row) return
    select(id); editing = id
    el.style.width = Math.max(el.offsetWidth, 72) + 'px'
    el.replaceChildren()
    const input = document.createElement('input')
    input.value = initial ?? row.text
    input.maxLength = 300
    stop(input)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing) return // 中文输入法组词中的 Enter/Esc 不处理
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(true) }
      if (e.key === 'Escape') { e.preventDefault(); commitEdit(false) }
    })
    input.addEventListener('blur', () => commitEdit(true))
    el.appendChild(input)
    input.focus()
    initial === null ? input.select() : input.setSelectionRange(input.value.length, input.value.length)
  }
  function commitEdit(saveIt) {
    if (!editing) return
    const id = editing, row = rowOf(id), el = els.get(id)
    const input = el?.querySelector('input')
    editing = null
    if (el) el.style.width = ''
    if (row && saveIt && input) {
      const value = input.value.trim() || '主题'
      if (value !== row.text) {
        const old = row.text
        row.text = value
        save.patch(id, { text: value }).catch((e) => { row.text = old; syncView(); ui.onError?.('保存失败：' + e.message) })
      }
    }
    syncView()
    viewport.focus()
  }

  async function addChildTo(parent) {
    if (!parent) return
    let side, sortOrder
    if (!parent.parent_id) {
      const kids = childrenOf(parent.id)
      const left = kids.filter((k) => k.side === 'left').length
      side = kids.length - left <= left ? 'right' : 'left'
      sortOrder = kids.filter((k) => (k.side || 'right') === side).length
    } else {
      side = meta.get(parent.id)?.side || parent.side || 'right'
      sortOrder = childrenOf(parent.id).length
    }
    try {
      const row = await save.create({ parentId: parent.id, text: '新主题', side, sortOrder })
      if (parent.collapsed) { parent.collapsed = 0; save.patch(parent.id, { collapsed: false }).catch(() => {}) }
      rows.push(row)
      syncView(); select(row.id); beginEdit(row.id)
    } catch (e) { ui.onError?.('无法新建主题：' + e.message) }
  }
  async function addSibling() {
    const current = rowOf(sel)
    if (!current) return
    if (!current.parent_id) return addChildTo(current)
    const parent = rowOf(current.parent_id)
    const side = meta.get(current.id)?.side || current.side || 'right'
    const siblings = childrenOf(parent.id).filter((t) => parent.parent_id || (t.side || 'right') === side)
    const index = siblings.indexOf(current)
    try {
      await Promise.all(siblings.slice(index + 1).map((t) => {
        t.sort_order += 1
        return save.patch(t.id, { sortOrder: t.sort_order })
      }))
      const row = await save.create({ parentId: parent.id, text: '新主题', side, sortOrder: index + 1 })
      rows.push(row)
      syncView(); select(row.id); beginEdit(row.id)
    } catch (e) { ui.onError?.('无法新建主题：' + e.message) }
  }
  async function removeSelected() {
    const current = rowOf(sel)
    if (!current || !current.parent_id) return
    const removeIds = subtreeIds(current.id)
    try {
      await save.remove(current.id)
      for (let i = rows.length - 1; i >= 0; i--) if (removeIds.has(rows[i].id)) rows.splice(i, 1)
      select(current.parent_id)
      syncView()
    } catch (e) { ui.onError?.('删除失败：' + e.message) }
  }
  function moveSibling(direction) {
    const current = rowOf(sel)
    if (!current?.parent_id) return
    const parent = rowOf(current.parent_id)
    const side = meta.get(current.id)?.side
    const list = childrenOf(parent.id).filter((t) => parent.parent_id || (meta.get(t.id)?.side || t.side) === side)
    const from = list.indexOf(current), to = from + direction
    if (to < 0 || to >= list.length) return
    const other = list[to], a = current.sort_order, b = other.sort_order
    current.sort_order = b; other.sort_order = a
    syncView()
    Promise.all([save.patch(current.id, { sortOrder: b }), save.patch(other.id, { sortOrder: a })])
      .catch(() => { current.sort_order = a; other.sort_order = b; syncView(); ui.onError?.('排序保存失败') })
  }
  /** 落点算成什么样,只此一处说了算 —— 拖拽预览和真正落库读的是同一个答案。 */
  function planMove(id, targetId, dropX) {
    const target = rowOf(targetId)
    // side 只有根的直接子主题说得上:挂到根上看落点在哪半边,挂到别处就跟随祖先。
    const side = !target.parent_id
      ? (dropX < 0 ? 'left' : 'right')
      : (meta.get(targetId)?.side || target.side || 'right')
    const siblings = childrenOf(targetId).filter((t) => t.id !== id && (target.parent_id || (t.side || 'right') === side))
    return { parent_id: targetId, side, sort_order: siblings.length ? Math.max(...siblings.map((t) => t.sort_order)) + 1 : 0 }
  }

  /** 试排:临时按落点改一下树,算出"放手之后"的布局,再原样改回来。 */
  function targetsIfDropped(id, targetId, dropX) {
    const row = rowOf(id), target = rowOf(targetId)
    const from = { parent_id: row.parent_id, side: row.side, sort_order: row.sort_order }
    const wasCollapsed = target.collapsed
    Object.assign(row, planMove(id, targetId, dropX))
    target.collapsed = 0 // 收起的父节点接住了子树,预览里就得是展开的
    const t = layoutTargets()
    Object.assign(row, from)
    target.collapsed = wasCollapsed
    return t
  }

  /** 拖拽落手时的换父。位置在预览里已经摆好了,这里只负责让它成真并落库。 */
  async function reparent(id, targetId, dropX) {
    const row = rowOf(id), target = rowOf(targetId)
    if (!row || !target) return
    const from = { parent_id: row.parent_id, side: row.side, sort_order: row.sort_order }
    const plan = planMove(id, targetId, dropX)
    Object.assign(row, plan)
    const wasCollapsed = target.collapsed // 收起的父节点接住了子树,顺手展开,不然像是拖丢了
    if (wasCollapsed) target.collapsed = 0
    syncView()
    select(id)
    try {
      await save.patch(id, { parentId: targetId, side: plan.side, sortOrder: plan.sort_order })
      if (wasCollapsed) save.patch(target.id, { collapsed: false }).catch(() => {})
    } catch (e) {
      Object.assign(row, from)
      if (wasCollapsed) target.collapsed = 1
      syncView(); ui.onError?.('移动失败：' + e.message)
    }
  }
  function navigate(key) {
    const pos = cur.get(sel)
    if (!pos) return
    const cand = visibleList()
      .filter((m) => m.n.id !== sel)
      .map((m) => ({ id: m.n.id, p: cur.get(m.n.id) }))
      .filter(({ p }) => p && (
        key === 'ArrowLeft' ? p.x < pos.x - 10 : key === 'ArrowRight' ? p.x > pos.x + 10 :
        key === 'ArrowUp' ? p.y < pos.y - 10 : p.y > pos.y + 10))
    const score = ({ p }) => {
      const dx = Math.abs(p.x - pos.x), dy = Math.abs(p.y - pos.y)
      return key === 'ArrowLeft' || key === 'ArrowRight' ? dx + dy * 2.4 : dy + dx * 1.8
    }
    cand.sort((a, b) => score(a) - score(b))
    if (cand[0]) select(cand[0].id)
  }

  /* ---------------- 视图 ---------------- */
  function applyView() {
    world.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`
    viewport.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`
    viewport.style.backgroundPosition = `${pan.x}px ${pan.y}px`
    ui.onZoom?.(zoom)
  }
  function zoomAt(clientX, clientY, factor) {
    const r = viewport.getBoundingClientRect()
    const sx = clientX - r.left, sy = clientY - r.top
    const wx = (sx - pan.x) / zoom, wy = (sy - pan.y) / zoom
    const z = Math.min(2.2, Math.max(.25, zoom * factor))
    zoom = z; pan.x = sx - wx * z; pan.y = sy - wy * z
    applyView()
  }
  function zoomBy(factor) {
    const r = viewport.getBoundingClientRect()
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor)
  }
  // 实际大小:100%,根主题(世界坐标原点)居中
  function reset() {
    const r = viewport.getBoundingClientRect()
    zoom = 1; pan.x = r.width / 2; pan.y = r.height / 2
    applyView()
  }
  function fit() {
    const r = viewport.getBoundingClientRect()
    if (!lastTargets.size) return reset()
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
    for (const [id, t] of lastTargets) {
      const s = meas.get(id) || { w: 100, h: 40 }
      minX = Math.min(minX, t.x - s.w / 2); maxX = Math.max(maxX, t.x + s.w / 2)
      minY = Math.min(minY, t.y - s.h / 2); maxY = Math.max(maxY, t.y + s.h / 2)
    }
    zoom = Math.min(1.15, Math.max(.3, Math.min((r.width - 160) / (maxX - minX), (r.height - 200) / (maxY - minY))))
    pan.x = r.width / 2 - (minX + maxX) / 2 * zoom
    pan.y = r.height / 2 - (minY + maxY) / 2 * zoom
    applyView()
  }

  /* ---------------- 输入 ---------------- */
  // 平移 / 双指捏合:统一 pointer 多指跟踪(1 指平移,2 指捏合 + 跟随中点)。
  // 配合 viewport 的 touch-action:none,触屏拖动不会被浏览器当滚动手势接管。
  const ptrs = new Map() // pointerId -> {x, y}
  let pinchDist = 0, dragMoved = false

  // 拖节点换父:按住卡片拖到另一张卡片上放手。整棵子树跟手走 —— 拖动期间直接改 cur
  // 再重画,连线自然跟着弯,不必为拖拽单开一套渲染。落点算完还是走 syncView 的老路。
  const DRAG_SLOP = 4 // 小于这个位移算点击,不算拖
  let drag = null // {id, pointerId, sub:Set, base:Map, sx, sy, target, wx}

  /** 屏幕坐标 → 世界坐标 */
  function toWorld(clientX, clientY) {
    const r = viewport.getBoundingClientRect()
    return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom }
  }
  /** 落点下的可见节点。自己和自己的子孙不算 —— 挂到子孙上会成环。 */
  function dropTargetAt(w) {
    // 吸附会让树重排,当前落点自己也会挪 —— 判定框放宽一圈再认输,
    // 否则它从指针底下滑走就会立刻丢,树弹回去,又命中,来回抖。
    const hit = (id, pad = 0) => {
      const c = cur.get(id), size = meas.get(id)
      return c && size && Math.abs(w.x - c.x) <= size.w / 2 + pad && Math.abs(w.y - c.y) <= size.h / 2 + pad
    }
    if (drag.target && hit(drag.target, 14)) return drag.target
    for (const m of visibleList()) if (!drag.sub.has(m.n.id) && hit(m.n.id)) return m.n.id
    return null
  }
  function markTarget(id) {
    if (drag.target === id) return
    if (drag.target) els.get(drag.target)?.classList.remove('drop')
    drag.target = id
    if (id) els.get(id)?.classList.add('drop')
  }
  function endDrag() {
    if (!drag) return null
    const finished = drag
    els.get(finished.id)?.classList.remove('dragging')
    if (finished.target) els.get(finished.target)?.classList.remove('drop')
    document.body.style.cursor = ''
    drag = null
    return finished
  }

  function onNodePointerDown(e, id) {
    e.stopPropagation()
    select(id)
    const row = rowOf(id)
    if (!row?.parent_id || editing === id || e.button > 0) return // 根主题挪不动,编辑中不拖
    const el = els.get(id)
    const sub = subtreeIds(id)
    const base = new Map()
    for (const kid of sub) { const c = cur.get(kid); if (c) base.set(kid, { ...c }) }
    drag = { id, pointerId: e.pointerId, sub, base, sx: e.clientX, sy: e.clientY, target: null, wx: 0, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  /** 悬空态:枝条归手指管,基准点重置成"此刻的位置 + 此刻的指针" */
  function rebaseFollow(e) {
    drag.sx = e.clientX; drag.sy = e.clientY
    drag.base = new Map()
    for (const id of drag.sub) { const c = cur.get(id); if (c) drag.base.set(id, { ...c }) }
  }
  function onNodePointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) <= DRAG_SLOP) return
      drag.moved = true
      cancelAnimationFrame(rafId) // 上一轮布局动画还没跑完的话,别和跟手抢同一批节点
      els.get(drag.id)?.classList.add('dragging')
      document.body.style.cursor = 'grabbing'
    }
    const w = toWorld(e.clientX, e.clientY)
    drag.wx = w.x
    // 命中判定看指针,不看卡片 —— 吸附之后卡片会让开,判定才不会来回抖。
    const next = dropTargetAt(w)
    if (next !== drag.target) {
      markTarget(next)
      if (next) {
        // 有落点:整棵树排成"放手之后"的样子,枝条自己吸附到将落的位置。
        // 这是 XMind 这类产品的做法 —— 拖拽期间画的是结果,不是来路。
        animate(targetsIfDropped(drag.id, next, w.x), [])
      } else {
        // 落点丢了:其余节点归位,枝条重新跟手
        rebaseFollow(e)
        animate(lastTargets, [], drag.sub)
      }
    }
    if (drag.target) return // 吸附中,位置由上面那次动画负责
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
    for (const [id, b] of drag.base) {
      const c = { x: b.x + dx / zoom, y: b.y + dy / zoom, o: b.o ?? 1 }
      cur.set(id, c); placeEl(id, c)
    }
    drawEdges()
  }
  function onNodePointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const finished = endDrag()
    if (!finished.moved) return // 只是点了一下,选中已经做过了
    const row = rowOf(finished.id)
    // 落在空白处、落回原父节点、落在自己身上 —— 都当没拖,弹回原位
    if (!finished.target || finished.target === row?.parent_id) { syncView(); return }
    void reparent(finished.id, finished.target, finished.wx)
  }

  function onPointerDown(e) {
    if (e.button > 1 || e.target.closest('.node,[data-ui],button,input')) return
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    viewport.setPointerCapture(e.pointerId)
    if (ptrs.size === 1) dragMoved = false
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    if (e.pointerType === 'mouse') document.body.style.cursor = 'grabbing'
  }
  function onPointerMove(e) {
    const p = ptrs.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
    if (ptrs.size === 1) { pan.x += dx; pan.y += dy; applyView() }
    else if (ptrs.size === 2) {
      pan.x += dx / 2; pan.y += dy / 2 // 每指贡献一半 ≈ 中点平移
      const [a, b] = [...ptrs.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist)
      else applyView()
      pinchDist = dist
    }
  }
  function onPointerUp(e) {
    if (!ptrs.delete(e.pointerId)) return
    pinchDist = 0
    if (!ptrs.size) {
      document.body.style.cursor = ''
      if (!dragMoved) select(null)
    }
  }
  // 滚轮即缩放(触控板捏合走的也是这条);平移靠拖空白
  function onWheel(e) {
    const t = e.target.closest?.('.txt')
    if (t && t.scrollHeight > t.clientHeight) return // 长文字交给节点内部滚动
    e.preventDefault()
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .008))
  }
  function onKeydown(e) {
    if (e.isComposing) return
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); reset(); return }
    if (!sel) return
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveSibling(e.key === 'ArrowUp' ? -1 : 1) }
    else if (e.key === 'Tab') { e.preventDefault(); addChildTo(rowOf(sel)) }
    else if (e.key === 'Enter') { e.preventDefault(); addSibling() }
    else if (e.key === ' ' || e.key === 'F2') { e.preventDefault(); beginEdit(sel) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
    else if (e.key === 'Escape') select(null)
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); navigate(e.key) }
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && e.key.trim()) { e.preventDefault(); beginEdit(sel, e.key) }
  }
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerUp)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeydown)

  /* ---------------- 启动 ---------------- */
  syncView()
  select(rootRow()?.id || null)
  reset()
  viewport.focus()

  return {
    addChild: () => addChildTo(rowOf(sel)),
    addSibling,
    removeSelected,
    canRemove: (id) => Boolean(rowOf(id)?.parent_id), // 根主题删不得
    zoomBy,
    reset,
    fit,
    destroy() {
      window.removeEventListener('keydown', onKeydown)
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('pointermove', onPointerMove)
      viewport.removeEventListener('pointerup', onPointerUp)
      viewport.removeEventListener('pointercancel', onPointerUp)
      viewport.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(rafId)
      // React 会保留 world/svg 挂载点并重新创建引擎；旧节点和连线必须一起清掉。
      for (const element of els.values()) element.remove()
      els.clear()
      svg.replaceChildren()
      preview = null
    },
  }
}
