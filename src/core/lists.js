// 有序列表的层级编号:一级 1. 2. 3. → 二级 a. b. c. → 三级 i. ii. iii. → 更深循环。
// 纯函数,无 DOM 依赖。存盘仍是标准 Markdown(1. 2. 3.),样式只在显示层按嵌套深度套用。

export const LIST_STYLES = ['decimal', 'lower-alpha', 'lower-roman']

/** 第 depth 层(从 0 开始)用的样式。 */
export const styleForDepth = (depth) => LIST_STYLES[((depth % 3) + 3) % 3]

/** 1→a, 26→z, 27→aa, 28→ab …(与 Word/飞书一致的"二十六进制"字母编号)。 */
export function toAlpha(n) {
  if (!Number.isInteger(n) || n < 1) return String(n)
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s
  return s
}

/** 1→i, 4→iv, 9→ix, 14→xiv …;大于 3999 退回阿拉伯数字。 */
export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n)
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = '', x = n
  for (const [v, r] of map) while (x >= v) { s += r; x -= v }
  return s
}

/** 把序号渲染成该样式的标记文本,例如 (3,'lower-alpha') → "c."。 */
export function marker(n, style) {
  if (style === 'lower-alpha') return toAlpha(n) + '.'
  if (style === 'lower-roman') return toRoman(n) + '.'
  return n + '.'
}

/**
 * 给一棵嵌套列表算每一项的"完整显示标记"。
 *   items: [{ children: items[] , start? }]   start 为该层起始序号(默认 1)
 * 返回扁平数组 [{ path:[0,1,0], depth, n, marker, style }],按文档顺序。
 * 同一层并列的项编号连续;进入子层重新从 start 开始。
 */
export function numberTree(items, { start = 1, depth = 0 } = {}) {
  const out = []
  items.forEach((it, i) => {
    const n = start + i
    const style = styleForDepth(depth)
    out.push({ depth, n, style, marker: marker(n, style), item: it })
    if (it.children?.length) out.push(...numberTree(it.children, { start: it.start ?? 1, depth: depth + 1 }))
  })
  return out
}

// ---------------- 缩进:修改缩进时保持子层的相对层级 ----------------
/**
 * 在"列表项树"上做缩进/提升,返回新树(不改原树)。纯函数,供测试固定语义;
 * 编辑器里的实际操作用 ProseMirror 命令实现,语义与此一致。
 *   path: 目标项在树中的位置,如 [1] 表示顶层第 2 项,[1,0] 表示它的第 1 个子项。
 *   缩进(sink):目标项连同它的整棵子树,成为"前一个同级兄弟"的最后一个子项;没有前一个兄弟则不能缩进。
 *   提升(lift):目标项连同整棵子树,移到父项之后成为父项的下一个兄弟;
 *             它后面的同级兄弟留在原父项下(不并入它的子树);顶层项不能再提升(返回 null)。
 */
export function sinkItem(tree, path) {
  const idx = path[path.length - 1]
  if (idx === 0) return null
  const clone = structuredClone(tree)
  const parentList = listAt(clone, path.slice(0, -1))
  const [item] = parentList.splice(idx, 1)
  const prev = parentList[idx - 1]
  prev.children = prev.children || []
  prev.children.push(item)
  return clone
}

export function liftItem(tree, path) {
  if (path.length === 1) return null
  const clone = structuredClone(tree)
  const parentPath = path.slice(0, -1)
  const siblings = listAt(clone, parentPath)
  const idx = path[path.length - 1]
  const [item] = siblings.splice(idx, 1)
  const grandList = listAt(clone, parentPath.slice(0, -1))
  grandList.splice(parentPath[parentPath.length - 1] + 1, 0, item)
  if (siblings.length === 0) delete clone_get(clone, parentPath).children
  return clone
}

function listAt(tree, path) {
  let list = tree
  for (const i of path) list = list[i].children
  return list
}
function clone_get(tree, path) {
  let node = { children: tree }
  for (const i of path) node = node.children[i]
  return node
}

/** 把树压成文本便于断言:每项一行,按深度缩进。 */
export function dumpTree(tree, depth = 0) {
  return tree.flatMap((it) => ['  '.repeat(depth) + it.text, ...(it.children ? dumpTree(it.children, depth + 1) : [])])
}
