// 连接点与连线路径:纯函数。
//
// 每个节点四条边各有一个连接点(边中点)。连线端点 = (节点, 边)。
// 未指定边时,按两个节点中心的相对方位自动选最近的一对。

import { shapeAnchors } from './shapes.js'

export const SIDES = ['top', 'right', 'bottom', 'left']

export function anchorPoint(n, side) {
  if (n.type === 'shape' && n.kind && n.kind !== 'text') {
    const p = shapeAnchors(n.kind, n.width, n.height)[side] || shapeAnchors(n.kind, n.width, n.height).right
    return { x: n.x + p.x, y: n.y + p.y }
  }
  switch (side) {
    case 'top': return { x: n.x + n.width / 2, y: n.y }
    case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height }
    case 'left': return { x: n.x, y: n.y + n.height / 2 }
    default: return { x: n.x + n.width, y: n.y + n.height / 2 }
  }
}

const NORMAL = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

export function autoSide(from, to) {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) * from.height > Math.abs(dy) * from.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

export const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

export const ROUTES = ['curve', 'orthogonal', 'straight']

/** 计算一条连线的几何:端点、路径、标签位置。按 edge.route 选择路由(默认曲线)。 */
export function edgeGeometry(edge, from, to) {
  const fs = edge.fromSide || autoSide(from, to)
  const ts = edge.toSide || autoSide(to, from)
  const a = anchorPoint(from, fs)
  const b = anchorPoint(to, ts)
  if (edge.route === 'straight') return straightBetween(a, fs, b, ts)
  if (edge.route === 'orthogonal') return orthogonalBetween(a, fs, b, ts, from, to, Number.isFinite(edge.bend) ? edge.bend : 0)
  return pathBetween(a, fs, b, ts)
}

export function straightBetween(a, fs, b, ts) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  return { a, b, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: ang, startAngle: ang + Math.PI, fromSide: fs, toSide: ts, points: [a, b] }
}

const STUB = 24

/**
 * 正交折线:从 a 沿 fs 方向伸出一段,再走水平/垂直线到 b 前方,最后沿 ts 的反方向进入 b。
 * 只做"出入方向感知"的折线(3~5 段),不做全局避障;但保证:
 *   - 第一段离开起点的方向 = fs 的法线方向,最后一段进入终点的方向 = ts 法线的反方向
 *   - 每一段都是水平或垂直的
 *   - 相邻重复点/共线点会被合并
 */
export function orthogonalBetween(a, fs, b, ts, fromBox, toBox, bend = 0) {
  const na = NORMAL[fs], nb = NORMAL[ts || opposite[fs]]
  const p1 = { x: a.x + na.x * STUB, y: a.y + na.y * STUB }
  const p2 = { x: b.x + nb.x * STUB, y: b.y + nb.y * STUB }
  const horizA = na.x !== 0, horizB = nb.x !== 0
  let mids
  if (horizA && horizB) {
    // 两端都水平出入:若方向"相向"且中间有空间 → 在中点竖线换道;否则绕外侧
    const facing = (na.x > 0 && p1.x <= p2.x) || (na.x < 0 && p1.x >= p2.x)
    if (facing && nb.x === -na.x) {
      const mx = (p1.x + p2.x) / 2 + bend
      mids = [{ x: mx, y: p1.y }, { x: mx, y: p2.y }]
    } else {
      const x = (na.x > 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x)) + bend
      const my = (verticalGap(fromBox, toBox) ?? (p1.y + p2.y) / 2) + bend
      mids = nb.x === na.x ? [{ x, y: p1.y }, { x, y: p2.y }] : [{ x: p1.x, y: my }, { x: p2.x, y: my }]
    }
  } else if (!horizA && !horizB) {
    const facing = (na.y > 0 && p1.y <= p2.y) || (na.y < 0 && p1.y >= p2.y)
    if (facing && nb.y === -na.y) {
      const my = (p1.y + p2.y) / 2 + bend
      mids = [{ x: p1.x, y: my }, { x: p2.x, y: my }]
    } else {
      const y = (na.y > 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y)) + bend
      const mx = (horizontalGap(fromBox, toBox) ?? (p1.x + p2.x) / 2) + bend
      mids = nb.y === na.y ? [{ x: p1.x, y }, { x: p2.x, y }] : [{ x: mx, y: p1.y }, { x: mx, y: p2.y }]
    }
  } else if (horizA) {
    // 水平出、垂直入:一个拐点
    mids = [{ x: p2.x, y: p1.y }]
  } else {
    mids = [{ x: p1.x, y: p2.y }]
  }
  const pts = simplify([a, p1, ...mids, p2, b])
  const d = 'M ' + pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(' L ')
  const last = pts[pts.length - 2], first = pts[1]
  // 可拖动的"中段"= 受 bend 影响的那两个中间点之间的线段(两点都还在化简后的折线里才算)
  let handle = null
  if (mids.length === 2) {
    const [m1, m2] = mids
    const has = (p) => pts.some((q) => Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01)
    if (has(m1) && has(m2) && Math.hypot(m1.x - m2.x, m1.y - m2.y) > 1) handle = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2, axis: Math.abs(m1.x - m2.x) < 0.01 ? 'x' : 'y' }
  }
  return { a, b, d, mid: midOfPolyline(pts), angle: Math.atan2(b.y - last.y, b.x - last.x), startAngle: Math.atan2(a.y - first.y, a.x - first.x), fromSide: fs, toSide: ts, points: pts, handle }
}

const r2 = (n) => Math.round(n * 100) / 100

function verticalGap(A, B) {
  if (!A || !B) return null
  if (A.y + A.height <= B.y) return (A.y + A.height + B.y) / 2
  if (B.y + B.height <= A.y) return (B.y + B.height + A.y) / 2
  return null
}
function horizontalGap(A, B) {
  if (!A || !B) return null
  if (A.x + A.width <= B.x) return (A.x + A.width + B.x) / 2
  if (B.x + B.width <= A.x) return (B.x + B.width + A.x) / 2
  return null
}

/** 去掉重复点与共线中间点。 */
export function simplify(pts) {
  const out = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue
    out.push(p)
    while (out.length >= 3) {
      const [u, v, w] = out.slice(-3)
      const colinear = (Math.abs(u.x - v.x) < 0.01 && Math.abs(v.x - w.x) < 0.01) || (Math.abs(u.y - v.y) < 0.01 && Math.abs(v.y - w.y) < 0.01)
      if (!colinear) break
      out.splice(out.length - 2, 1)
    }
  }
  return out
}

/** 折线按长度的中点(放标签)。 */
export function midOfPolyline(pts) {
  const segs = []
  let total = 0
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l }
  let half = total / 2
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) { const t = segs[i] ? half / segs[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t } }
    half -= segs[i]
  }
  return pts[pts.length - 1]
}

// 端点样式:startEnd / endEnd ∈ none | arrow | dot;兼容旧字段 arrow: 'none' | 'both'
export const END_STYLES = ['none', 'arrow', 'dot']
export function edgeEnds(edge) {
  let start = edge.startEnd, end = edge.endEnd
  if (end === undefined) end = edge.arrow === 'none' ? 'none' : 'arrow'
  if (start === undefined) start = edge.arrow === 'both' ? 'arrow' : 'none'
  return { start: END_STYLES.includes(start) ? start : 'none', end: END_STYLES.includes(end) ? end : 'arrow' }
}

/** 任意两点(含拖动中、终点是鼠标的情况)的路径。toSide 可缺省:此时曲线朝向取与起点方向相反。 */
export function pathBetween(a, fs, b, ts) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.max(40, Math.min(200, dist * 0.4))
  // 两端的朝向都可能缺失(拖动中的游离端点):缺失时朝向取"背离对端"的方向
  const away = (p, q) => ({ x: (p.x - q.x) / (Math.hypot(p.x - q.x, p.y - q.y) || 1), y: (p.y - q.y) / (Math.hypot(p.x - q.x, p.y - q.y) || 1) })
  const na = fs && NORMAL[fs] ? NORMAL[fs] : away(a, b)
  const nb = ts && NORMAL[ts] ? NORMAL[ts] : away(b, a)
  const c1 = { x: a.x + na.x * k, y: a.y + na.y * k }
  const c2 = { x: b.x + nb.x * k, y: b.y + nb.y * k }
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
  // 三次贝塞尔 t=0.5 处
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
  // 终点切线方向(用于箭头朝向):从 c2 指向 b
  const angle = Math.atan2(b.y - c2.y, b.x - c2.x)
  const startAngle = Math.atan2(a.y - c1.y, a.x - c1.x)
  return { a, b, d, mid, angle, startAngle, fromSide: fs, toSide: ts, points: [a, b] }
}

/** 在 world 坐标 (x,y) 附近找最近的连接点;阈值为 world 单位。 */
export function nearestAnchor(nodes, x, y, threshold, excludeId) {
  let best = null
  for (const n of nodes) {
    if (n.id === excludeId) continue
    for (const s of SIDES) {
      const p = anchorPoint(n, s)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d <= threshold && (!best || d < best.dist)) best = { node: n, side: s, dist: d }
    }
  }
  return best
}

/** (x,y) 落在哪个节点上(卡片优先于框,后画的优先)。 */
export function hitNode(nodes, x, y, excludeId) {
  const inside = (n) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
  for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].type !== 'group' && nodes[i].id !== excludeId && inside(nodes[i])) return nodes[i]
  for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].type === 'group' && nodes[i].id !== excludeId && inside(nodes[i])) return nodes[i]
  return null
}
