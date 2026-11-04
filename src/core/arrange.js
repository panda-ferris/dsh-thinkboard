// 排版:把"对齐 / 等距分布 / 框适配内容"算成一批 ops。纯函数,UI 与 agent 都可复用。
//
// 约定:
//  - 选中框时,框内的卡片会随框一起移动(moveNodes 自带),所以先剔除"已被选中的框包含的卡片"。
//  - 只产出 moveNodes / updateNode,不直接改 board。

import { containedBy } from './ops.js'
import { remapClusters, unitsOf } from './cluster.js'

export const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']

/** 去掉被已选中的框包含的卡片(它们会跟着框动)。 */
export function topLevel(board, ids) {
  const set = new Set(ids)
  const covered = new Set()
  for (const n of board.nodes) {
    if (n.type === 'group' && set.has(n.id)) for (const c of containedBy(board, n)) covered.add(c.id)
  }
  return board.nodes.filter((n) => set.has(n.id) && !covered.has(n.id))
}

const move = (ids, dx, dy) => (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? null : { op: 'moveNodes', ids, dx, dy })

/**
 * 排版的"单元":组合是一个整体(外包盒 = 成员并集),其余节点各自一个单元。
 * 每个单元 = { ids: 一起移动的节点 id, x, y, width, height }。框内被已选框带走的卡片不单独成单元。
 */
export function layoutUnits(board, ids, scope = []) {
  const flat = new Set(topLevel(board, ids).map((n) => n.id))
  const units = unitsOf(board, [...flat], scope)
  return units.map((u) => ({ ids: u.nodes.map((n) => n.id), x: u.rect.x, y: u.rect.y, width: u.rect.w, height: u.rect.h }))
}

export function alignOps(board, ids, mode, scope = []) {
  const units = layoutUnits(board, ids, scope)
  if (units.length < 2 || !ALIGN_MODES.includes(mode)) return []
  const L = Math.min(...units.map((n) => n.x)), R = Math.max(...units.map((n) => n.x + n.width))
  const T = Math.min(...units.map((n) => n.y)), B = Math.max(...units.map((n) => n.y + n.height))
  const out = []
  for (const n of units) {
    let dx = 0, dy = 0
    if (mode === 'left') dx = L - n.x
    else if (mode === 'right') dx = R - (n.x + n.width)
    else if (mode === 'hcenter') dx = (L + R) / 2 - (n.x + n.width / 2)
    else if (mode === 'top') dy = T - n.y
    else if (mode === 'bottom') dy = B - (n.y + n.height)
    else dy = (T + B) / 2 - (n.y + n.height / 2)
    const op = move(n.ids, Math.round(dx), Math.round(dy))
    if (op) out.push(op)
  }
  return out
}

/** 沿 axis('x' 水平 / 'y' 垂直)等间距分布:两端不动,中间的间隙相等。至少 3 个单元。 */
export function distributeOps(board, ids, axis, scope = []) {
  const units = layoutUnits(board, ids, scope)
  if (units.length < 3) return []
  const pos = axis === 'x' ? (n) => n.x : (n) => n.y
  const size = axis === 'x' ? (n) => n.width : (n) => n.height
  const sorted = [...units].sort((a, b) => pos(a) - pos(b))
  const first = sorted[0], last = sorted[sorted.length - 1]
  const total = pos(last) + size(last) - pos(first)
  const gap = (total - sorted.reduce((s, n) => s + size(n), 0)) / (sorted.length - 1)
  const out = []
  let cursor = pos(first) + size(first) + gap
  for (const n of sorted.slice(1, -1)) {
    const d = Math.round(cursor - pos(n))
    const op = axis === 'x' ? move(n.ids, d, 0) : move(n.ids, 0, d)
    if (op) out.push(op)
    cursor += size(n) + gap
  }
  return out
}

/** 让框正好包住它当前包含的卡片(四周留 padding,顶部多留出标题的高度)。没有卡片则不动。 */
export function fitGroupOps(board, groupId, { padding = 32, titleHeight = 40 } = {}) {
  const g = board.nodes.find((n) => n.id === groupId && n.type === 'group')
  if (!g) return []
  const inside = containedBy(board, g)
  if (!inside.length) return []
  const x1 = Math.min(...inside.map((n) => n.x)) - padding
  const y1 = Math.min(...inside.map((n) => n.y)) - padding - titleHeight
  const x2 = Math.max(...inside.map((n) => n.x + n.width)) + padding
  const y2 = Math.max(...inside.map((n) => n.y + n.height)) + padding
  const patch = { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) }
  if (patch.x === g.x && patch.y === g.y && patch.width === g.width && patch.height === g.height) return []
  return [{ op: 'updateNode', id: g.id, patch }]
}

/** 把选中的卡片包进一个新框(框的 id 由调用方给定)。 */
export function wrapInGroupOps(board, ids, groupId, { padding = 32, titleHeight = 40, color = 'blue' } = {}) {
  const nodes = board.nodes.filter((n) => ids.includes(n.id) && n.type !== 'group')
  if (!nodes.length) return []
  const x1 = Math.min(...nodes.map((n) => n.x)) - padding
  const y1 = Math.min(...nodes.map((n) => n.y)) - padding - titleHeight
  const x2 = Math.max(...nodes.map((n) => n.x + n.width)) + padding
  const y2 = Math.max(...nodes.map((n) => n.y + n.height)) + padding
  return [{ op: 'addNode', node: { id: groupId, type: 'group', x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1), label: '', color } }]
}

// ---------------- 复制 / 粘贴 ----------------
export const CLIPBOARD_MARK = 'dsh-thinkboard/v1:'

/** 序列化选中的元素(含它们之间的连线)。框会连同框内卡片一起复制。 */
export function copyPayload(board, ids) {
  const set = new Set(ids)
  for (const n of board.nodes) if (n.type === 'group' && set.has(n.id)) for (const c of containedBy(board, n)) set.add(c.id)
  const nodes = board.nodes.filter((n) => set.has(n.id))
  const edges = board.edges.filter((e) => set.has(e.fromNode) && set.has(e.toNode))
  return CLIPBOARD_MARK + JSON.stringify({ board: board.id, nodes, edges })
}

export function parsePayload(text) {
  if (typeof text !== 'string' || !text.startsWith(CLIPBOARD_MARK)) return null
  try {
    const p = JSON.parse(text.slice(CLIPBOARD_MARK.length))
    return Array.isArray(p.nodes) && p.nodes.length ? p : null
  } catch { return null }
}

/**
 * 生成粘贴用的 ops。新 id 由 newId() 给出;整体平移到 at(中心点)或偏移 (offset,offset)。
 * 跨白板粘贴时图片文件在目标白板里不存在,所以丢弃图片卡片及其连线。
 */
export function pasteOps(payload, { boardId, at, offset = 32, newId }) {
  const sameBoard = payload.board === boardId
  const nodes = payload.nodes.filter((n) => sameBoard || n.type !== 'image')
  if (!nodes.length) return { ops: [], ids: [] }
  const map = new Map(nodes.map((n) => [n.id, newId('n')]))
  let dx = offset, dy = offset
  if (at) {
    const x1 = Math.min(...nodes.map((n) => n.x)), y1 = Math.min(...nodes.map((n) => n.y))
    const x2 = Math.max(...nodes.map((n) => n.x + n.width)), y2 = Math.max(...nodes.map((n) => n.y + n.height))
    dx = Math.round(at.x - (x1 + x2) / 2); dy = Math.round(at.y - (y1 + y2) / 2)
  }
  // 组合换新 id:副本自成组合,不会并入原组合
  const remapped = remapClusters(nodes, () => newId('c'))
  const ops = remapped.map((n) => ({ op: 'addNode', node: { ...n, id: map.get(n.id), x: n.x + dx, y: n.y + dy } }))
  for (const e of payload.edges || []) {
    if (map.has(e.fromNode) && map.has(e.toNode)) ops.push({ op: 'addEdge', edge: { ...e, id: newId('e'), fromNode: map.get(e.fromNode), toNode: map.get(e.toNode) } })
  }
  return { ops, ids: [...map.values()] }
}

// ---------------- 框成员关系 ----------------
/**
 * 一组被移动的节点(已含位移 dx/dy)落在哪个框里。
 * 规则:被移动的"顶层"节点(框不算)的中心点落在框内才算归属;多个节点时,所有节点都落在同一个框内才高亮该框。
 * 重叠的框取层级最上(数组靠后)且面积最小的。被移动的框自己、以及它的子孙不能当目标。
 * 返回 { target: 框 id | null, inside: 落入的节点 id[], leaving: 原本在某框内、现在要离开的 { nodeId, groupId }[] }
 */
export function dropTarget(board, movedIds, dx, dy) {
  const moved = new Set(movedIds)
  const cards = board.nodes.filter((n) => moved.has(n.id) && n.type !== 'group')
  if (!cards.length) return { target: null, inside: [], leaving: [] }
  const center = (n) => ({ x: n.x + dx + n.width / 2, y: n.y + dy + n.height / 2 })
  const groups = board.nodes.filter((g) => g.type === 'group' && !moved.has(g.id))
  const containing = (p) => groups.filter((g) => p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height)
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]
  const perCard = cards.map((c) => ({ c, g: containing(center(c)) }))
  const first = perCard[0].g
  const allSame = first && perCard.every((x) => x.g?.id === first.id)
  const leaving = []
  for (const c of cards) {
    const was = board.nodes.filter((g) => g.type === 'group' && !moved.has(g.id) && containingNow(g, c)).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const now = perCard.find((x) => x.c.id === c.id).g
    if (was && (!now || now.id !== was.id)) leaving.push({ nodeId: c.id, groupId: was.id })
  }
  return { target: allSame ? first.id : null, inside: allSame ? cards.map((c) => c.id) : [], leaving }
}
function containingNow(g, n) {
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2
  return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height
}

/** 框当前包含的成员数(卡片与图形;不含框)。 */
export function memberCount(board, group) {
  return containedBy(board, group).length
}

// ---------------- 拖入框时的自适应 ----------------
/**
 * 一批节点(已含位移 dx/dy)落进框 frame 时,框需要长成多大才能完整容纳它们。
 *
 * 规则(为了拖动时不抖、不伤害别的元素):
 *   - 只增不缩:框永远不会因为拖入而变小。
 *   - 只向"需要"的方向扩:哪一侧装不下就扩哪一侧,其余边保持原位。
 *   - 留出 padding;顶部额外留出标题栏高度,卡片不会压在标题上。
 *   - 不"吞"别人:归属由中心点决定,框一长大,框外邻居的中心可能落进来,变成意外成员。
 *     传入 bystanders(不是被拖元素、且当前不在框内的节点)时,扩张会在碰到它们的中心点之前停下;
 *     此时框装不下被拖元素的全部,返回的矩形仍覆盖被拖元素的**中心点**(归属一致),只是不再完整包住。
 * 返回 { x, y, width, height },或 null(不需要扩)。
 */
export function growFrameToFit(frame, movedRects, { padding = 24, titleHeight = 44, bystanders = [] } = {}) {
  if (!movedRects.length) return null
  let L = Math.min(...movedRects.map((r) => r.x)) - padding
  let T = Math.min(...movedRects.map((r) => r.y)) - titleHeight
  let R = Math.max(...movedRects.map((r) => r.x + r.width)) + padding
  let B = Math.max(...movedRects.map((r) => r.y + r.height)) + padding
  let x = Math.min(frame.x, L), y = Math.min(frame.y, T)
  let x2 = Math.max(frame.x + frame.width, R), y2 = Math.max(frame.y + frame.height, B)

  if (bystanders.length) {
    // 被拖元素的中心点必须被框覆盖(否则拖入就无意义);这是扩张的"下限"
    const cxs = movedRects.map((r) => r.x + r.width / 2), cys = movedRects.map((r) => r.y + r.height / 2)
    const needL = Math.min(frame.x, ...cxs), needT = Math.min(frame.y, ...cys)
    const needR = Math.max(frame.x + frame.width, ...cxs), needB = Math.max(frame.y + frame.height, ...cys)
    const hits = (b, l, t, r, bt) => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= l && cx <= r && cy >= t && cy <= bt }
    const before = (b) => hits(b, frame.x, frame.y, frame.x + frame.width, frame.y + frame.height)
    const outsiders = bystanders.filter((b) => !before(b))
    // 逐边回退:先试完整扩张;若吞了邻居,把该边收缩到"刚好不吞"且不小于下限
    const swallowed = () => outsiders.filter((b) => hits(b, x, y, x2, y2))
    for (const side of ['right', 'bottom', 'left', 'top']) {
      for (let guard = 0; guard < 40 && swallowed().length; guard++) {
        const sw = swallowed()
        if (side === 'right' && x2 > needR) x2 = Math.max(needR, Math.min(x2, ...sw.map((b) => b.x + b.width / 2 - 1)))
        else if (side === 'bottom' && y2 > needB) y2 = Math.max(needB, Math.min(y2, ...sw.map((b) => b.y + b.height / 2 - 1)))
        else if (side === 'left' && x < needL) x = Math.min(needL, Math.max(x, ...sw.map((b) => b.x + b.width / 2 + 1)))
        else if (side === 'top' && y < needT) y = Math.min(needT, Math.max(y, ...sw.map((b) => b.y + b.height / 2 + 1)))
        else break
      }
    }
  }
  if (x === frame.x && y === frame.y && x2 === frame.x + frame.width && y2 === frame.y + frame.height) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(x2 - x), height: Math.round(y2 - y) }
}

/** 框外的"旁观者":既不是被拖元素、也不是框本身、当前也不在框内的节点(框扩张时要避免吞掉它们)。 */
export function bystandersOf(board, frame, movedIds) {
  const moved = new Set(movedIds)
  return board.nodes.filter((n) => n.type !== 'group' && !moved.has(n.id) && n.id !== frame.id)
    .map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }))
}

/**
 * 拖动结束时,把落入的节点都装进目标框:框先扩大,再产出 ops。
 * 框外邻居不会被顺带吞进来;框内已有元素保持不动(框只向外长,所以它们仍在框内)。
 */
export function dropIntoFrameOps(board, frameId, movedIds, dx, dy, opts) {
  const frame = board.nodes.find((n) => n.id === frameId && n.type === 'group')
  if (!frame) return []
  const set = new Set(movedIds)
  const rects = board.nodes.filter((n) => set.has(n.id) && n.type !== 'group').map((n) => ({ x: n.x + dx, y: n.y + dy, width: n.width, height: n.height }))
  const grown = growFrameToFit(frame, rects, { ...opts, bystanders: bystandersOf(board, frame, movedIds) })
  return grown ? [{ op: 'updateNode', id: frame.id, patch: grown }] : []
}
