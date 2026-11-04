// 元素组合:纯函数,无 DOM / Node 依赖。
//
// 数据模型
//   - 节点的 `cluster` 字段 = 它所属的组合路径,从外到内用 "/" 连接,例如 "c1" 或 "c1/c2"。
//   - 组合本身不是节点,只是 id 标签:没有"看不见的节点",也不影响其它功能对 board.nodes 的遍历。
//   - 与"框"(group 节点,几何包含)完全独立:一个节点可以同时在框里、也在某个组合里。
//
// 命名:为避免与已有的 group(框)混淆,代码里统一叫 cluster。

const SEP = '/'

export const clusterPath = (n) => (typeof n?.cluster === 'string' && n.cluster ? n.cluster.split(SEP) : [])
export const clusterOf = (n, depth) => clusterPath(n)[depth] // depth 从 0(最外层)开始

/** 两个节点路径的公共前缀长度。 */
function commonDepth(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** 一个组合(由 path 前缀标识)的全部成员节点。 */
export function membersOf(board, path) {
  const prefix = Array.isArray(path) ? path : String(path).split(SEP)
  return board.nodes.filter((n) => {
    const p = clusterPath(n)
    return p.length >= prefix.length && prefix.every((id, i) => p[i] === id)
  })
}

/**
 * 点击节点 n 时,应该选中哪些节点。
 *   - scope:当前"进入"到的组合路径(双击进入后的上下文);默认 [](最外层)。
 *   - 返回的是"点击所在单元"的全部节点:n 在 scope 之下的第一层组合内,则选中该整个组合;否则只选 n 自己。
 */
export function selectionUnitFor(board, n, scope = []) {
  const p = clusterPath(n)
  // n 必须在当前 scope 之内,否则 scope 失效,退回最外层
  const inScope = scope.every((id, i) => p[i] === id)
  const base = inScope ? scope : []
  if (p.length > base.length) return membersOf(board, p.slice(0, base.length + 1)).map((x) => x.id)
  return [n.id]
}

/** 双击进入:返回新的 scope(多进一层);没有更深一层则返回 null(此时双击应走原有的"编辑"行为)。 */
export function enterScope(n, scope = []) {
  const p = clusterPath(n)
  const inScope = scope.every((id, i) => p[i] === id)
  const base = inScope ? scope : []
  return p.length > base.length ? p.slice(0, base.length + 1) : null
}

/**
 * 把一批已选中的节点规整成"顶层单元"集合:
 *   选中的节点里,凡是组合成员的,都按其最外层组合(相对 scope)补全为整组。
 * 用于移动/复制/删除/对齐——保证选中组合的一部分时,整组一起动。
 */
export function expandToUnits(board, ids, scope = []) {
  const out = new Set()
  for (const id of ids) {
    const n = board.nodes.find((x) => x.id === id)
    if (!n) continue
    for (const m of selectionUnitFor(board, n, scope)) out.add(m)
  }
  return [...out]
}

/** 多个节点的"单元":每个单元是 { key, nodes },key 为组合路径或节点 id。对齐/分布按单元计算外包盒。 */
export function unitsOf(board, ids, scope = []) {
  const units = new Map()
  for (const id of expandToUnits(board, ids, scope)) {
    const n = board.nodes.find((x) => x.id === id)
    const p = clusterPath(n)
    const inScope = scope.every((s, i) => p[i] === s)
    const base = inScope ? scope.length : 0
    const key = p.length > base ? p.slice(0, base + 1).join(SEP) : 'n:' + n.id
    if (!units.has(key)) units.set(key, [])
    units.get(key).push(n)
  }
  return [...units.entries()].map(([key, nodes]) => ({ key, nodes, rect: bounds(nodes) }))
}

export function bounds(nodes) {
  const x = Math.min(...nodes.map((n) => n.x)), y = Math.min(...nodes.map((n) => n.y))
  const x2 = Math.max(...nodes.map((n) => n.x + n.width)), y2 = Math.max(...nodes.map((n) => n.y + n.height))
  return { x, y, w: x2 - x, h: y2 - y }
}

// ---------------- 组合 / 取消组合 ----------------
export const CLUSTER_MIN = 2

/**
 * 把一批节点组成新组合,返回 ops(updateNode)。
 *   - 至少 2 个"单元"才有意义(选中同一个组合的全部成员 = 1 个单元,不重复组合)。
 *   - 新组合包在现有组合之外:所有被选中节点的现有路径整体加在 newId 之后,即 "newId/旧路径"。
 *     这样原有的嵌套结构原样保留(相对层级不变)。
 *   - 只能组合处于同一 scope 下的单元(同一层级),否则按它们的公共前缀作为新组合的"父路径"。
 */
export function groupOps(board, ids, newId, scope = []) {
  const units = unitsOf(board, ids, scope)
  if (units.length < CLUSTER_MIN) return []
  const paths = units.flatMap((u) => u.nodes.map(clusterPath))
  // 公共前缀 = 新组合插入的位置(它们必须在同一父组合下)
  let common = paths[0]
  for (const p of paths) common = common.slice(0, commonDepth(common, p))
  const ops = []
  for (const u of units) for (const n of u.nodes) {
    const p = clusterPath(n)
    const next = [...common, newId, ...p.slice(common.length)]
    ops.push({ op: 'updateNode', id: n.id, patch: { cluster: next.join(SEP) } })
  }
  return ops
}

/**
 * 取消组合:解散选中单元的最外层(相对 scope)组合 —— 去掉路径里的那一层,内层组合保持不变。
 * 若选中的单元不是组合,返回空数组。
 */
export function ungroupOps(board, ids, scope = []) {
  const ops = []
  const seen = new Set()
  for (const u of unitsOf(board, ids, scope)) {
    if (u.key.startsWith('n:')) continue
    if (seen.has(u.key)) continue
    seen.add(u.key)
    const depth = u.key.split(SEP).length - 1 // 要去掉的那一层的下标
    for (const n of u.nodes) {
      const p = clusterPath(n)
      const next = p.filter((_, i) => i !== depth)
      ops.push({ op: 'updateNode', id: n.id, patch: { cluster: next.length ? next.join(SEP) : null } })
    }
  }
  return ops
}

/** 一个节点现在属于几层组合。 */
export const clusterDepth = (n) => clusterPath(n).length

// ---------------- 整体缩放 ----------------
/**
 * 把一组节点按外包盒的缩放比例整体缩放,返回 ops。
 *   from: 缩放前的外包盒 {x,y,w,h};to: 缩放后的外包盒。
 *   每个节点的位置与大小按相对外包盒的比例映射;最小尺寸 24(图形/卡片不会缩没)。
 *   保持图片的宽高比:图片节点按宽度缩放,高度跟随(与单个图片缩放一致)。
 */
export function scaleOps(nodes, from, to, { minSize = 24 } = {}) {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1
  return nodes.map((n) => {
    const w = Math.max(minSize, n.width * sx)
    const h = n.type === 'image' && n.width ? Math.max(minSize, w * (n.height / n.width)) : Math.max(minSize, n.height * sy)
    return {
      op: 'updateNode', id: n.id,
      patch: { x: Math.round(to.x + (n.x - from.x) * sx), y: Math.round(to.y + (n.y - from.y) * sy), width: Math.round(w), height: Math.round(h) },
    }
  })
}

// ---------------- 复制:保持组合结构 ----------------
/**
 * 复制时给组合换新 id(否则副本会和原件并入同一个组合)。
 *   idMap:旧组合 id → 新组合 id(调用方提供生成器);副本节点的 cluster 按映射改写。
 *   只改写"被复制范围内"出现的组合;范围外的外层组合(例如只复制了某个内层组合)保持原样会让副本
 *   混进外层组合,所以统一改成新 id。
 */
export function remapClusters(nodes, newId) {
  const map = new Map()
  const get = (old) => { if (!map.has(old)) map.set(old, newId()); return map.get(old) }
  return nodes.map((n) => {
    const p = clusterPath(n)
    if (!p.length) return n
    return { ...n, cluster: p.map(get).join(SEP) }
  })
}

// ---------------- 校验 ----------------
export const CLUSTER_RE = /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40}){0,7}$/
export function validCluster(v) {
  return typeof v === 'string' && CLUSTER_RE.test(v)
}
