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
