// 拖动时的对齐线与间距提示。纯函数,单位为画布坐标。
//
//   snapMove(moving, others, threshold) -> { dx, dy, guides, gaps }
//     moving / others: { x, y, w, h }
//     dx, dy : 需要附加的吸附位移
//     guides : [{ axis:'x'|'y', pos, from, to }]   对齐线(axis 'x' = 竖线,位置为 x)
//     gaps   : [{ axis:'x'|'y', from, to, cross, value }]  等间距提示(axis 'x' = 水平方向的间隔)
//
// 做法:每个轴上收集"吸附候选"(边/中线对齐、等间距),取距离最近且小于阈值者;
// 应用吸附后,在最终位置上重新扫描所有成立的对齐与等间距,作为提示画出来。

const EPS = 0.5

/**
 * 对齐线只画"这次确实吸附上"的那一组:
 *  - 以前是"吸附后,在最终位置上扫描所有对齐"。候选一多(每个元素 3 条边 × 每个目标 3 条线),
 *    总有几条恰好落在容差里,于是线几乎一直在,用户看到线后继续移动仍然看到线。
 *  - 现在某个轴没有吸附(dx 或 dy 为 0 且没有候选在阈值内)就不画该轴的线;画的线必须与"被吸附的那个候选"同位置。
 *  - 间距提示同理:只在该轴发生了"等间距吸附"时才显示。
 */
export function snapMove(moving, others, threshold) {
  const sx = pickSnap(candidatesX(moving, others), threshold)
  const sy = pickSnap(candidatesY(moving, others), threshold)
  const dx = sx ? sx.offset : 0, dy = sy ? sy.offset : 0
  const m = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const all = hints(m, others)
  // 对齐线:只保留"被吸附的那个位置"上的线。同一位置可能有多个目标共线,它们仍一并画出(那才是用户想看到的"和谁对齐")
  const snapped = (axis, sn) => (sn?.kind === 'align' ? sn.pos : null)
  const px = snapped('x', sx), py = snapped('y', sy)
  return {
    dx, dy,
    guides: all.guides.filter((g) => (g.axis === 'x' ? px !== null && Math.abs(g.pos - px) < EPS : py !== null && Math.abs(g.pos - py) < EPS)),
    gaps: all.gaps.filter((g) => (g.axis === 'x' ? sx?.kind === 'space' : sy?.kind === 'space')),
  }
}

/** 只与"附近"的元素比较:按中心距离取最近的 NEAR 个。远处的元素对齐没有参考价值,还会让线满屏都是。 */
export const NEAR = 6
function nearest(m, others, n = NEAR) {
  if (others.length <= n) return others
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2
  return [...others].sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)).slice(0, n)
}

/**
 * 单轴对齐候选。只取有意义的几类配对,而不是 3×3 全组合:
 *   左↔左、中↔中、右↔右(同类边对齐),左↔右、右↔左(并排贴靠)。
 * 中线↔边这类交叉组合几乎总是巧合,会让线无处不在。
 */
function pairs(a0, a1, b0, b1) {
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2
  return [[a0, b0], [am, bm], [a1, b1], [a0, b1], [a1, b0]]
}
function candidatesX(m, others) {
  const out = []
  for (const o of nearest(m, others)) for (const [s, t] of pairs(m.x, m.x + m.w, o.x, o.x + o.w)) out.push({ offset: t - s, kind: 'align', pos: t })
  for (const d of spacingOffsets(m, nearest(m, others), 'x')) out.push({ offset: d, kind: 'space' })
  return out
}
function candidatesY(m, others) {
  const out = []
  for (const o of nearest(m, others)) for (const [s, t] of pairs(m.y, m.y + m.h, o.y, o.y + o.h)) out.push({ offset: t - s, kind: 'align', pos: t })
  for (const d of spacingOffsets(m, nearest(m, others), 'y')) out.push({ offset: d, kind: 'space' })
  return out
}

/** 取距离最近且在阈值内的候选;对齐与间距同距离时优先对齐(更常见、更不意外)。没有则 null。 */
function pickSnap(list, threshold) {
  let best = null
  for (const c of list) {
    const a = Math.abs(c.offset)
    if (a > threshold) continue
    if (!best || a < Math.abs(best.offset) - 1e-9 || (Math.abs(a - Math.abs(best.offset)) < 1e-9 && c.kind === 'align' && best.kind !== 'align')) best = c
  }
  return best
}

// ---- 轴抽象:'x' 表示在水平方向排布,垂直方向须有重叠 ----
const AX = {
  x: { pos: (r) => r.x, size: (r) => r.w, cpos: (r) => r.y, csize: (r) => r.h },
  y: { pos: (r) => r.y, size: (r) => r.h, cpos: (r) => r.x, csize: (r) => r.w },
}

function overlapsCross(a, b, ax) {
  const A = AX[ax]
  return A.cpos(a) < A.cpos(b) + A.csize(b) && A.cpos(b) < A.cpos(a) + A.csize(a)
}

/** 与 m 在交叉轴上有重叠的候选,按主轴位置排序。 */
function lane(m, others, ax) {
  const A = AX[ax]
  return others.filter((o) => overlapsCross(m, o, ax)).sort((a, b) => A.pos(a) - A.pos(b))
}

function spacingOffsets(m, others, ax) {
  const A = AX[ax]
  const L = lane(m, others, ax)
  const out = []
  const end = (r) => A.pos(r) + A.size(r)
  // 1) 夹在 a、b 之间,左右间距相等
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]
      const free = A.pos(b) - end(a) - A.size(m)
      if (free >= 0) out.push(end(a) + free / 2 - A.pos(m))
    }
  }
  // 2) 沿用相邻两块之间的间距,继续往右/往左排
  for (let i = 0; i + 1 < L.length; i++) {
    const a = L[i], b = L[i + 1]
    const g = A.pos(b) - end(a)
    if (g < 0) continue
    out.push(end(b) + g - A.pos(m))
    out.push(A.pos(a) - g - A.size(m) - A.pos(m))
  }
  return out
}

// ---- 提示:在最终位置上扫描 ----
function hints(m, others) {
  const near = nearest(m, others)
  return { guides: alignGuides(m, near), gaps: [...spacingGaps(m, near, 'x'), ...spacingGaps(m, near, 'y')] }
}

function alignGuides(m, others) {
  const guides = []
  const add = (axis, pos, rects) => {
    const A = axis === 'x' ? AX.x : AX.y
    const lo = Math.min(...rects.map((r) => A.cpos(r)))
    const hi = Math.max(...rects.map((r) => A.cpos(r) + A.csize(r)))
    if (!guides.some((g) => g.axis === axis && Math.abs(g.pos - pos) < EPS && g.from === lo && g.to === hi)) {
      guides.push({ axis, pos, from: lo, to: hi })
    }
  }
  for (const axis of ['x', 'y']) {
    const A = AX[axis]
    const byPos = new Map()
    for (const o of others) {
      for (const [s, t] of pairs(A.pos(m), A.pos(m) + A.size(m), A.pos(o), A.pos(o) + A.size(o))) {
        if (Math.abs(t - s) < EPS) {
          const key = Math.round(s * 2) / 2
          if (!byPos.has(key)) byPos.set(key, [m])
          byPos.get(key).push(o)
        }
      }
    }
    for (const [pos, rects] of byPos) add(axis, pos, rects)
  }
  return guides
}

function spacingGaps(m, others, ax) {
  const A = AX[ax]
  const L = lane(m, others, ax)
  const end = (r) => A.pos(r) + A.size(r)
  const cross = (r) => A.cpos(r) + A.csize(r) / 2
  const gaps = []
  const push = (a, b) => {
    const g = A.pos(b) - end(a)
    gaps.push({ axis: ax, from: end(a), to: A.pos(b), cross: (cross(a) + cross(b)) / 2, value: Math.round(g) })
  }
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]
      const g1 = A.pos(m) - end(a), g2 = A.pos(b) - end(m)
      if (g1 >= 0 && g2 >= 0 && Math.abs(g1 - g2) < EPS && A.pos(m) >= end(a) - EPS && end(m) <= A.pos(b) + EPS) {
        push(a, m)
        push(m, b)
      }
    }
  }
  for (let i = 0; i + 1 < L.length; i++) {
    const a = L[i], b = L[i + 1]
    const g = A.pos(b) - end(a)
    if (g < 0) continue
    if (Math.abs(A.pos(m) - end(b) - g) < EPS && A.pos(m) >= end(b)) {
      push(a, b)
      push(b, m)
    }
    if (Math.abs(A.pos(a) - end(m) - g) < EPS && end(m) <= A.pos(a)) {
      push(m, a)
      push(a, b)
    }
  }
  // 去重
  return gaps.filter((g, i) => gaps.findIndex((h) => h.axis === g.axis && Math.abs(h.from - g.from) < EPS && Math.abs(h.to - g.to) < EPS && Math.abs(h.cross - g.cross) < EPS) === i)
}

/** 一组矩形的外包矩形。 */
export function boundsOf(rects) {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: x2 - x, h: y2 - y }
}
