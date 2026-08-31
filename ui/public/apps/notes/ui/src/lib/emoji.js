// 完整 Unicode emoji 数据(emojibase-data,中文 label + 标签)。
// 用 dynamic import,Vite 会把它单独 chunk —— 只有首次打开 picker 时才加载。

let cache = null

export const loadEmojiData = async () => {
  if (cache) return cache

  const [emojisMod, messagesMod] = await Promise.all([
    import('emojibase-data/zh/data.json'),
    import('emojibase-data/zh/messages.json'),
  ])
  const emojis   = emojisMod.default
  const messages = messagesMod.default

  // 过滤掉 component 组(肤色 / 发色修饰符,不适合直接 pick)
  const groups = messages.groups
    .filter((g) => g.key !== 'component')
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ key: g.key, label: g.message, order: g.order, list: [] }))

  const byOrder = new Map(groups.map((g) => [g.order, g]))

  const all = []
  for (const e of emojis) {
    const g = byOrder.get(e.group)
    if (!g) continue
    const item = {
      emoji: e.emoji,
      label: e.label || '',
      tags:  e.tags  || [],
    }
    g.list.push(item)
    all.push(item)
  }

  cache = { groups, all }
  return cache
}

export const pickRandomEmoji = (all) => {
  if (!all || !all.length) return null
  return all[Math.floor(Math.random() * all.length)].emoji
}
