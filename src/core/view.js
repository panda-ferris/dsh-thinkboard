// 悬浮条定位 & 全局搜索 & 小地图:都是纯函数,与 DOM 无关。

// ---------------- 悬浮条定位 ----------------
/**
 * 把一个 w×h 的浮条放在"目标矩形"(屏幕坐标)附近,并保证整条都留在视口内。
 *  - 优先在目标上方,留 gap;上方放不下(会顶出视口)则放到目标下方;
 *  - 目标整体不在视口内时,贴着最近的视口边缘(top/bottom),水平方向夹在视口内;
 *  - 返回 { x, y, side } side: 'above' | 'below' | 'pinned-top' | 'pinned-bottom'
 */
export function placeFloating(target, size, viewport, { gap = 10, margin = 8, reserveTop = 0, reserveBottom = 0 } = {}) {
  const minY = viewport.top + margin + reserveTop
  const maxY = viewport.bottom - margin - reserveBottom - size.h
  const cx = target.x + target.w / 2
  let x = cx - size.w / 2
  x = Math.max(viewport.left + margin, Math.min(x, viewport.right - margin - size.w))

  const above = target.y - gap - size.h
  const below = target.y + target.h + gap
  const offTop = target.y + target.h < viewport.top
  const offBottom = target.y > viewport.bottom
  if (offTop) return { x, y: minY, side: 'pinned-top' }
  if (offBottom) return { x, y: maxY, side: 'pinned-bottom' }
  if (above >= minY) return { x, y: above, side: 'above' }
  if (below <= maxY) return { x, y: below, side: 'below' }
  // 上下都放不下(目标很高、几乎占满视口):放在视口内最靠上的位置
  return { x, y: minY, side: 'pinned-top' }
}

/** world 矩形 → 屏幕矩形(相对画布左上角)。 */
export function worldToScreen(r, vp) {
  return { x: r.x * vp.k + vp.x, y: r.y * vp.k + vp.y, w: r.w * vp.k, h: r.h * vp.k }
}

// ---------------- 搜索 ----------------
const norm = (s) => String(s ?? '').toLowerCase()

/** 取一个节点里可被搜索的文字。 */
export function nodeTexts(n) {
  return [n.title, n.label, n.text, n.alt].filter((x) => typeof x === 'string' && x)
}

/**
 * 在白板里找匹配。多个词用空格分隔,必须全部命中(AND),不区分大小写。
 * 返回按相关度排序的结果:标题命中 > 正文命中;命中越靠前越靠前。
 * 每条: { id, kind:'node'|'edge', type, title, snippet, field, score }
 */
export function searchBoard(board, query, { limit = 50 } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out = []
  for (const n of board.nodes) {
    const title = n.type === 'group' ? n.label : n.title
    const body = typeof n.text === 'string' ? n.text : ''
    const all = norm([title, body].filter(Boolean).join('\n'))
    if (!words.every((w) => all.includes(w))) continue
    const inTitle = words.every((w) => norm(title).includes(w))
    const first = Math.min(...words.map((w) => { const i = all.indexOf(w); return i < 0 ? 1e9 : i }))
    out.push({
      id: n.id, kind: 'node', type: n.type, title: title || '', field: inTitle ? 'title' : 'text',
      snippet: snippet(inTitle ? title : body, words),
      score: (inTitle ? 1000 : 0) + (n.type === 'group' ? 50 : 0) - Math.min(first, 900),
    })
  }
  for (const e of board.edges) {
    if (!e.label) continue
    const l = norm(e.label)
    if (!words.every((w) => l.includes(w))) continue
    out.push({ id: e.id, kind: 'edge', type: 'edge', title: e.label, field: 'label', snippet: e.label, score: 500 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** 取命中词附近的片段;去掉 Markdown 记号,让预览更干净。 */
export function snippet(text, words, radius = 36) {
  const plain = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-\[\]()!|]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  const low = plain.toLowerCase()
  const at = Math.min(...words.map((w) => { const i = low.indexOf(w); return i < 0 ? 1e9 : i }))
  if (at === 1e9) return plain.slice(0, radius * 2)
  const s = Math.max(0, at - radius), e = Math.min(plain.length, at + radius)
  return (s > 0 ? '…' : '') + plain.slice(s, e) + (e < plain.length ? '…' : '')
}

/** 把视口居中到某个矩形;放大到不超过 maxK,且尽量让目标占视口约 40%。 */
export function focusViewport(rect, size, { maxK = 1.2, minK = 0.25, fill = 0.4 } = {}) {
  const k = Math.max(minK, Math.min(maxK, fill * Math.min(size.w / rect.w, size.h / rect.h)))
  return { k, x: size.w / 2 - (rect.x + rect.w / 2) * k, y: size.h / 2 - (rect.y + rect.h / 2) * k }
}

// ---------------- 小地图 ----------------
/**
 * 小地图的坐标映射。
 *  - world: 内容外包盒 ∪ 当前视口(都在 world 坐标),再加一圈边距
 *  - 返回 { scale, ox, oy, w, h }:world→map: (x - ox) * scale,地图像素尺寸 w×h
 */
export function minimapLayout(board, viewportWorld, { width = 180, maxHeight = 130, pad = 40 } = {}) {
  const rects = board.nodes.map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }))
  rects.push(viewportWorld)
  const x1 = Math.min(...rects.map((r) => r.x)) - pad, y1 = Math.min(...rects.map((r) => r.y)) - pad
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + pad, y2 = Math.max(...rects.map((r) => r.y + r.h)) + pad
  const ww = x2 - x1, wh = y2 - y1
  const scale = Math.min(width / ww, maxHeight / wh)
  return { scale, ox: x1, oy: y1, w: Math.round(ww * scale), h: Math.round(wh * scale) }
}

export const toMap = (L, x, y) => ({ x: (x - L.ox) * L.scale, y: (y - L.oy) * L.scale })
export const fromMap = (L, mx, my) => ({ x: mx / L.scale + L.ox, y: my / L.scale + L.oy })

/** 点击/拖动小地图 → 新的 viewport(把点击处的 world 点放到屏幕中心)。 */
export function viewportFromMap(L, mx, my, size, k) {
  const p = fromMap(L, mx, my)
  return { k, x: size.w / 2 - p.x * k, y: size.h / 2 - p.y * k }
}

/** 当前 viewport 对应的 world 矩形。 */
export function viewportWorldRect(vp, size) {
  return { x: -vp.x / vp.k, y: -vp.y / vp.k, w: size.w / vp.k, h: size.h / vp.k }
}
