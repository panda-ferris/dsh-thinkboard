// 白板数据模型:纯函数,无 DOM / Node 依赖,Host 与 Client 共用。
//
// board = { schemaVersion, id, title, nodes: Node[], edges: Edge[] }
// Node  = { id, type, x, y, width, height, ...按类型的字段 }   type: 'text' | 'image' | 'group' | 未来类型
// Edge  = { id, fromNode, toNode, fromSide?, toSide?, label?, color?, dashed?, arrow? }
//
// 约定:未知字段、未知节点类型一律原样保留,旧版本插件不会弄丢新版本写入的数据。

export const SCHEMA_VERSION = 1

export const NODE_DEFAULTS = {
  text: { width: 320, height: 200 },
  image: { width: 280, height: 200 },
  group: { width: 480, height: 320 },
  shape: { width: 160, height: 80 },
  html: { width: 400, height: 300 },
}
export const FALLBACK_SIZE = { width: 320, height: 200 }

const KEY_ORDER = ['id', 'type', 'x', 'y', 'width', 'height', 'title', 'label', 'text', 'file', 'color']

export function uid(prefix = 'n') {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += (b % 36).toString(36)
  return `${prefix}${s}${Date.now().toString(36).slice(-3)}`
}

export function createBoard({ id = uid('b'), title = 'Untitled' } = {}) {
  return { schemaVersion: SCHEMA_VERSION, id, title, nodes: [], edges: [] }
}

/** 校验并补全默认值。不认识的字段保留;结构性错误抛出 Error。 */
export function normalizeBoard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('board is not an object')
  const version = raw.schemaVersion ?? 1
  if (!Number.isInteger(version) || version < 1) throw new Error('invalid schemaVersion')
  if (version > SCHEMA_VERSION) throw new Error(`board was written by a newer version (schemaVersion ${version})`)
  if (typeof raw.id !== 'string' || !raw.id) throw new Error('board.id is required')
  const seen = new Set()
  const nodes = []
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!n || typeof n.id !== 'string' || typeof n.type !== 'string' || seen.has(n.id)) continue
    seen.add(n.id)
    const d = NODE_DEFAULTS[n.type] ?? FALLBACK_SIZE
    nodes.push({
      ...n,
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: Math.max(1, num(n.width, d.width)),
      height: Math.max(1, num(n.height, d.height)),
    })
  }
  const edges = []
  const edgeIds = new Set()
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!e || typeof e.id !== 'string' || edgeIds.has(e.id) || !seen.has(e.fromNode) || !seen.has(e.toNode)) continue
    edgeIds.add(e.id)
    edges.push({ ...e })
  }
  return { ...raw, schemaVersion: SCHEMA_VERSION, title: typeof raw.title === 'string' ? raw.title : 'Untitled', nodes, edges }
}

function num(v, d) {
  return Number.isFinite(v) ? v : d
}

/** 稳定序列化:固定键顺序、一个节点/连线一行,便于 git diff 与文件同步合并。 */
export function serializeBoard(board) {
  const { schemaVersion, id, title, nodes, edges, ...rest } = board
  const line = (o) => JSON.stringify(sortKeys(o))
  const list = (arr) => (arr.length ? `[\n${arr.map((x) => '    ' + line(x)).join(',\n')}\n  ]` : '[]')
  const parts = [
    `  "schemaVersion": ${schemaVersion}`,
    `  "id": ${JSON.stringify(id)}`,
    `  "title": ${JSON.stringify(title)}`,
  ]
  for (const k of Object.keys(rest).sort()) parts.push(`  ${JSON.stringify(k)}: ${JSON.stringify(rest[k])}`)
  parts.push(`  "nodes": ${list(nodes)}`, `  "edges": ${list(edges)}`)
  return `{\n${parts.join(',\n')}\n}\n`
}

function sortKeys(o) {
  const out = {}
  const keys = Object.keys(o).filter((k) => o[k] !== undefined)
  const head = KEY_ORDER.filter((k) => keys.includes(k))
  const tail = keys.filter((k) => !KEY_ORDER.includes(k)).sort()
  for (const k of [...head, ...tail]) out[k] = o[k]
  return out
}

export function findNode(board, id) {
  return board.nodes.find((n) => n.id === id)
}

/** 渲染层级:框永远在卡片下面,其余按数组顺序。 */
export function layered(nodes) {
  return [...nodes.filter((n) => n.type === 'group'), ...nodes.filter((n) => n.type !== 'group')]
}

/** 简单摘要,给 agent 读。 */
export function summarize(board, { full = false } = {}) {
  const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s)
  return {
    id: board.id,
    title: board.title,
    nodes: board.nodes.map((n) => {
      const { id, type, x, y, width, height, title, label, color, file, cluster } = n
      const o = { id, type, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
      if (title) o.title = title
      if (label) o.label = label
      if (color) o.color = color
      if (file) o.file = file
      if (cluster) o.cluster = cluster
      if (typeof n.text === 'string') o.text = full ? n.text : clip(n.text, 200)
      return o
    }),
    edges: board.edges,
  }
}
