// 相邻同类列表合并:纯 ProseMirror 逻辑,无 DOM / React 依赖,可在 Node 里单测。
//
// 规则:同一个父节点里,两个"紧挨着的"、类型相同的列表(bulletList / orderedList / taskList)合并为一个。
// 有序与无序、被任何块隔开的,都不合并。
import { Transform } from '@tiptap/pm/transform'

export const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

/** 找出所有可合并的边界位置(文档坐标,指向两个列表之间)。 */
export function findJoinPoints(doc) {
  const points = []
  doc.descendants((node, pos) => {
    if (node.childCount < 2) return true
    let offset = pos + 1
    for (let i = 0; i < node.childCount - 1; i++) {
      const a = node.child(i), b = node.child(i + 1)
      offset += a.nodeSize
      if (LIST_TYPES.includes(a.type.name) && a.type === b.type) points.push(offset)
    }
    return true
  })
  // 文档根的子节点:descendants 不会访问根自身,单独处理
  let offset = 0
  for (let i = 0; i < doc.childCount - 1; i++) {
    const a = doc.child(i), b = doc.child(i + 1)
    offset += a.nodeSize
    if (LIST_TYPES.includes(a.type.name) && a.type === b.type) points.push(offset)
  }
  return points
}

/** 对 tr 应用合并;返回是否有改动。位置自后向前处理,避免前面的位置失效。 */
export function mergeAdjacentLists(tr) {
  const points = findJoinPoints(tr.doc).sort((x, y) => y - x)
  let changed = false
  for (const p of points) {
    try { tr.join(p); changed = true } catch { /* 结构不允许时跳过 */ }
  }
  return changed
}
