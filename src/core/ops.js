// 操作内核:UI 与 agent 共用的唯一修改入口。纯函数、不可变、原子(任一操作非法则整批不生效)。
//
// 操作清单(op 字段):
//   addNode     { node }                         node 可带 place:{ rightOf|below|leftOf|above: id, gap? } 代替 x/y
//   updateNode  { id, patch }                    不可改 id / type
//   moveNodes   { ids, dx, dy }                  移动框时框内卡片一并移动(按中心点几何包含)
//   removeNodes { ids }                          同时删除相关连线
//   addEdge     { edge }
//   updateEdge  { id, patch }
//   removeEdges { ids }
//   setTitle    { title }
//
// 新增操作类型只需在 HANDLERS 里加一项。

import { NODE_DEFAULTS, FALLBACK_SIZE, uid, normalizeBoard } from './model.js'
import { MAX_HTML_BYTES } from './content.js'
import { SHAPE_KINDS, SHAPE_DEFAULT_SIZE, DASHES } from './shapes.js'
import { ROUTES, END_STYLES } from './edges.js'
import { validCluster } from './cluster.js'

export class OpError extends Error {
  constructor(message, index) {
    super(index === undefined ? message : `op[${index}]: ${message}`)
    this.name = 'OpError'
    this.index = index
  }
}

const GAP = 40
const PROTECTED = new Set(['id', 'type'])
const ASSET_RE = /^assets\/[A-Za-z0-9._-]+$/

/** 按类型检查字段:类型、大小、资源路径形态。内核层的最后一道关,UI 与 agent 都绕不过。 */
function validateEdge(e) {
  if (e.route !== undefined && !ROUTES.includes(e.route)) throw new OpError(`edge.route must be one of: ${ROUTES.join(', ')}`)
  for (const k of ['startEnd', 'endEnd']) if (e[k] !== undefined && !END_STYLES.includes(e[k])) throw new OpError(`edge.${k} must be one of: ${END_STYLES.join(', ')}`)
  if (e.label !== undefined && typeof e.label !== 'string') throw new OpError('edge.label must be a string')
  if (e.bend !== undefined && !(Number.isFinite(e.bend) && Math.abs(e.bend) <= 5000)) throw new OpError('edge.bend must be a number within ±5000')
}

function validateNode(n) {
  if (n.type === 'html') {
    if (n.html !== undefined && typeof n.html !== 'string') throw new OpError('html must be a string')
    if (typeof n.html === 'string' && new TextEncoder().encode(n.html).length > MAX_HTML_BYTES) throw new OpError(`html exceeds ${MAX_HTML_BYTES} bytes`)
  }
  if (n.type === 'image') {
    if (n.file !== undefined && (typeof n.file !== 'string' || !ASSET_RE.test(n.file) || n.file.includes('..'))) throw new OpError('image.file must be like "assets/<name>"')
    if (n.caption !== undefined && typeof n.caption !== 'string') throw new OpError('image.caption must be a string')
  }
  if (n.type === 'shape') {
    if (n.kind !== 'text' && !SHAPE_KINDS.includes(n.kind)) throw new OpError(`shape.kind must be one of: text, ${SHAPE_KINDS.join(', ')}`)
    if (n.dash !== undefined && !(n.dash in DASHES)) throw new OpError('shape.dash must be solid | dashed | dotted')
    if (n.strokeWidth !== undefined && !(Number.isFinite(n.strokeWidth) && n.strokeWidth >= 0 && n.strokeWidth <= 12)) throw new OpError('shape.strokeWidth must be 0..12')
    if (n.fontSize !== undefined && !(Number.isFinite(n.fontSize) && n.fontSize >= 8 && n.fontSize <= 96)) throw new OpError('shape.fontSize must be 8..96')
    if (n.align !== undefined && !['left', 'center', 'right'].includes(n.align)) throw new OpError('shape.align must be left | center | right')
    for (const k of ['fill', 'stroke']) if (n[k] !== undefined && typeof n[k] !== 'string') throw new OpError(`shape.${k} must be a string`)
  }
  if (n.fold !== undefined && !['collapsed', 'expanded'].includes(n.fold)) throw new OpError('fold must be "collapsed" | "expanded" (omit it for the default state)')
  if (n.baseHeight !== undefined && !(Number.isFinite(n.baseHeight) && n.baseHeight > 0)) throw new OpError('baseHeight must be a positive number')
  if (n.cluster !== undefined && !validCluster(n.cluster)) throw new OpError('cluster must be ids joined by "/" (letters, digits, - _; at most 8 levels)')
  for (const k of ['title', 'label', 'text']) if (n[k] !== undefined && typeof n[k] !== 'string') throw new OpError(`${k} must be a string`)
  if (n.natural !== undefined && !(Number.isFinite(n.natural?.w) && Number.isFinite(n.natural?.h) && n.natural.w > 0 && n.natural.h > 0)) throw new OpError('natural must be {w,h} with positive numbers')
}

/** 给缺 id 的 addNode/addEdge 补 id,使客户端乐观结果与 Host 落盘结果完全一致。 */
export function ensureIds(ops) {
  return ops.map((op) => {
    if (op.op === 'addNode' && op.node && !op.node.id) return { ...op, node: { ...op.node, id: uid('n') } }
    if (op.op === 'addEdge' && op.edge && !op.edge.id) return { ...op, edge: { ...op.edge, id: uid('e') } }
    return op
  })
}

export function applyOps(board, ops) {
  if (!Array.isArray(ops)) throw new OpError('ops must be an array')
  let b = board
  const results = []
  ops.forEach((op, i) => {
    const h = op && HANDLERS[op.op]
    if (!h) throw new OpError(`unknown op "${op && op.op}"`, i)
    try {
      const r = h(b, op)
      b = r.board
      results.push(r.result ?? {})
    } catch (e) {
      if (e instanceof OpError) throw new OpError(e.message, i)
      throw e
    }
  })
  return { board: b, results }
}

const HANDLERS = {
  addNode(b, { node }) {
    if (!node || typeof node.type !== 'string') throw new OpError('node.type is required')
    const id = node.id || uid('n')
    if (b.nodes.some((n) => n.id === id)) throw new OpError(`node "${id}" already exists`)
    const sz = node.type === 'shape' && SHAPE_DEFAULT_SIZE[node.kind]
    const d = sz ? { width: sz[0], height: sz[1] } : node.type === 'shape' && node.kind === 'text' ? { width: 200, height: 40 } : NODE_DEFAULTS[node.type] ?? FALLBACK_SIZE
    const { place, ...rest } = node
    const full = { ...rest, id, width: rest.width ?? d.width, height: rest.height ?? d.height }
    if (!Number.isFinite(full.x) || !Number.isFinite(full.y)) {
      const pos = resolvePlacement(b, full, place)
      full.x = pos.x
      full.y = pos.y
    }
    validateNode(full)
    return { board: { ...b, nodes: [...b.nodes, full] }, result: { id } }
  },

  updateNode(b, { id, patch }) {
    const n = need(b, id)
    for (const k of Object.keys(patch || {})) if (PROTECTED.has(k)) throw new OpError(`cannot change "${k}"`)
    const next = { ...n, ...patch }
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k]
    if (next.width < 1 || next.height < 1) throw new OpError('width/height must be >= 1')
    validateNode(next)
    return { board: { ...b, nodes: b.nodes.map((x) => (x === n ? next : x)) } }
  },

  moveNodes(b, { ids, dx, dy }) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new OpError('dx/dy must be numbers')
    const set = new Set(ids)
    for (const id of set) need(b, id)
    for (const g of b.nodes) {
      if (g.type !== 'group' || !set.has(g.id)) continue
      for (const n of containedBy(b, g)) set.add(n.id)
    }
    return { board: { ...b, nodes: b.nodes.map((n) => (set.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) } }
  },

  removeNodes(b, { ids }) {
    const set = new Set(ids)
    for (const id of set) need(b, id)
    return {
      board: {
        ...b,
        nodes: dissolveLonely(b.nodes.filter((n) => !set.has(n.id))),
        edges: b.edges.filter((e) => !set.has(e.fromNode) && !set.has(e.toNode)),
      },
    }
  },

  addEdge(b, { edge }) {
    if (!edge) throw new OpError('edge is required')
    need(b, edge.fromNode)
    need(b, edge.toNode)
    if (edge.fromNode === edge.toNode) throw new OpError('edge cannot connect a node to itself')
    const id = edge.id || uid('e')
    if (b.edges.some((e) => e.id === id)) throw new OpError(`edge "${id}" already exists`)
    validateEdge(edge)
    return { board: { ...b, edges: [...b.edges, { ...edge, id }] }, result: { id } }
  },

  updateEdge(b, { id, patch }) {
    const e = b.edges.find((x) => x.id === id)
    if (!e) throw new OpError(`edge "${id}" not found`)
    for (const k of Object.keys(patch || {})) if (k === 'id') throw new OpError('cannot change "id"')
    const next = { ...e, ...patch }
    for (const k of Object.keys(next)) if (next[k] === null) delete next[k]
    if (patch.fromNode) need(b, next.fromNode)
    if (patch.toNode) need(b, next.toNode)
    validateEdge(next)
    return { board: { ...b, edges: b.edges.map((x) => (x === e ? next : x)) } }
  },

  removeEdges(b, { ids }) {
    const set = new Set(ids)
    return { board: { ...b, edges: b.edges.filter((e) => !set.has(e.id)) } }
  },

  setTitle(b, { title }) {
    if (typeof title !== 'string' || !title.trim()) throw new OpError('title must be a non-empty string')
    return { board: { ...b, title: title.trim() } }
  },
}

/**
 * 删除后,成员数不足 2 的组合没有意义:自动解散(去掉那一层),内层/外层组合按剩余结构保持。
 * 逐层处理,直到稳定。
 */
function dissolveLonely(nodes) {
  let cur = nodes
  for (let guard = 0; guard < 10; guard++) {
    const counts = new Map()
    for (const n of cur) {
      const p = typeof n.cluster === 'string' && n.cluster ? n.cluster.split('/') : []
      for (let i = 1; i <= p.length; i++) { const k = p.slice(0, i).join('/'); counts.set(k, (counts.get(k) || 0) + 1) }
    }
    const lonely = new Set([...counts].filter(([, c]) => c < 2).map(([k]) => k))
    if (!lonely.size) return cur
    cur = cur.map((n) => {
      if (typeof n.cluster !== 'string' || !n.cluster) return n
      const p = n.cluster.split('/')
      const keep = p.filter((_, i) => !lonely.has(p.slice(0, i + 1).join('/')))
      if (keep.length === p.length) return n
      const { cluster, ...rest } = n
      return keep.length ? { ...rest, cluster: keep.join('/') } : rest
    })
  }
  return cur
}

function need(b, id) {
  const n = b.nodes.find((x) => x.id === id)
  if (!n) throw new OpError(`node "${id}" not found`)
  return n
}

/** 几何上被框包含的卡片:中心点落在框内,且自身不是框。 */
export function containedBy(b, group) {
  return b.nodes.filter((n) => {
    if (n.type === 'group' || n.id === group.id) return false
    const cx = n.x + n.width / 2
    const cy = n.y + n.height / 2
    return cx >= group.x && cx <= group.x + group.width && cy >= group.y && cy <= group.y + group.height
  })
}

function resolvePlacement(b, node, place) {
  const gap = place?.gap ?? GAP
  const ref = place && (place.rightOf || place.below || place.leftOf || place.above)
  if (ref) {
    const r = need(b, ref)
    if (place.rightOf) return { x: r.x + r.width + gap, y: r.y }
    if (place.leftOf) return { x: r.x - node.width - gap, y: r.y }
    if (place.below) return { x: r.x, y: r.y + r.height + gap }
    return { x: r.x, y: r.y - node.height - gap }
  }
  if (b.nodes.length === 0) return { x: 0, y: 0 }
  // 无参照:放到现有内容右侧,顶部对齐
  const right = Math.max(...b.nodes.map((n) => n.x + n.width))
  const top = Math.min(...b.nodes.map((n) => n.y))
  return { x: right + gap, y: top }
}

export { normalizeBoard }
