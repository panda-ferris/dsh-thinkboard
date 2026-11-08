// 右栏状态的按白板记忆:纯函数,无 DOM / 存储依赖,可单测。
//
// 记什么(每个白板各一份):
//   open   右栏是否展开
//   tab    当前标签页 'chat' | 'detail'
//   detail 详情标签对应的卡片 id(tab 为 'detail' 时才有意义)
// 不记的:宽度(全局共用,换白板不该变宽窄)、对话内容(由会话自己保存)。
//
// 存储形态: { [boardId]: { open, tab, detail } }。容错:任何字段缺失/类型不对按默认处理,整体损坏回到默认,不抛错。

export const SIDE_DEFAULT = { open: true, tab: 'chat', detail: null }
const MAX_BOARDS = 200          // 记忆的白板数上限,防止无限增长;超出时丢弃最早写入的

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200

/** 把读到的任意值规整成合法的单个白板记录。tab=detail 但没有 detail id 时回到 chat。 */
export function normalizeSide(raw, fallbackOpen = SIDE_DEFAULT.open) {
  const o = isObj(raw) ? raw : {}
  const open = typeof o.open === 'boolean' ? o.open : fallbackOpen
  const detail = isId(o.detail) ? o.detail : null
  const tab = o.tab === 'detail' && detail ? 'detail' : 'chat'
  return { open, tab, detail: tab === 'detail' ? detail : null }
}

/** 从整张表里取某个白板的记录;没有记录时用 fallbackOpen(通常是全局上次的展开状态)。 */
export function sideFor(map, boardId, fallbackOpen = SIDE_DEFAULT.open) {
  if (!isObj(map) || !isId(boardId) || !Object.prototype.hasOwnProperty.call(map, boardId)) return normalizeSide(null, fallbackOpen)
  return normalizeSide(map[boardId], fallbackOpen)
}

/** 写入某个白板的记录,返回新表(不改入参)。记录与默认完全一致时不占位(保持存储精简)。 */
export function withSide(map, boardId, side) {
  const base = isObj(map) ? map : {}
  if (!isId(boardId)) return base
  const next = { ...base }
  delete next[boardId]                                   // 先删再加:最近写入的排在最后
  next[boardId] = normalizeSide(side)
  const keys = Object.keys(next)
  if (keys.length > MAX_BOARDS) for (const k of keys.slice(0, keys.length - MAX_BOARDS)) delete next[k]
  return next
}

/** 白板被删除后清理它的记录。 */
export function withoutSide(map, boardId) {
  if (!isObj(map) || !Object.prototype.hasOwnProperty.call(map, boardId)) return isObj(map) ? map : {}
  const next = { ...map }
  delete next[boardId]
  return next
}

/**
 * 恢复详情:记录里的卡片在白板里仍存在且是文字卡片 → 返回该 id;否则返回 null(调用方回到对话标签)。
 * nodes 是白板的节点数组。
 */
export function restorableDetail(side, nodes) {
  if (!side || side.tab !== 'detail' || !isId(side.detail) || !Array.isArray(nodes)) return null
  const n = nodes.find((x) => x && x.id === side.detail)
  return n && n.type === 'text' ? n.id : null
}
