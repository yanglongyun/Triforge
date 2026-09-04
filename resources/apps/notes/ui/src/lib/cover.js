// 预置封面 —— Unsplash 公开图。cover 字段存 preset:N 时查这张表,
// 存完整 URL 时直接用。将来想换图只改这里,DB 里的 preset:N 不动。
export const COVER_PRESETS = [
  { key: 'preset:1',  label: '远山',      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80' },
  { key: 'preset:2',  label: '湖山',      url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1600&q=80' },
  { key: 'preset:3',  label: '森林',      url: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1600&q=80' },
  { key: 'preset:4',  label: '海浪',      url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80' },
  { key: 'preset:5',  label: '晨雾',      url: 'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?w=1600&q=80' },
  { key: 'preset:6',  label: '紫霞',      url: 'https://images.unsplash.com/photo-1444080748397-f442aa95c3e5?w=1600&q=80' },
  { key: 'preset:7',  label: '渐变',      url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1600&q=80' },
  { key: 'preset:8',  label: '粉彩',      url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1600&q=80' },
]

const PRESET_MAP = Object.fromEntries(COVER_PRESETS.map(p => [p.key, p.url]))

export function resolveCoverUrl(cover) {
  if (!cover) return null
  return PRESET_MAP[cover] || cover
}

export function coverStyle(cover) {
  const url = resolveCoverUrl(cover)
  if (!url) return null
  return {
    backgroundImage:    `url(${JSON.stringify(url)})`,
    backgroundSize:     'cover',
    backgroundPosition: 'center',
  }
}
