// 表格工具条的纯逻辑:哪些操作当前可用、各操作对应的编辑器命令、位置计算。
// 不依赖 DOM / 编辑器实例,便于单测。可用性本身来自编辑器的 can()(库已处理"只剩一行/一列不能删"等),
// 这里只补库没有覆盖的产品规则。

/** 工具条按钮,按分组排列。id 稳定;cmd 是 Tiptap 命令名。 */
export const TABLE_ACTIONS = [
  { id: 'rowBefore', group: 'row', cmd: 'addRowBefore' },
  { id: 'rowAfter', group: 'row', cmd: 'addRowAfter' },
  { id: 'rowDelete', group: 'row', cmd: 'deleteRow', danger: true },
  { id: 'colBefore', group: 'col', cmd: 'addColumnBefore' },
  { id: 'colAfter', group: 'col', cmd: 'addColumnAfter' },
  { id: 'colDelete', group: 'col', cmd: 'deleteColumn', danger: true },
  { id: 'headerRow', group: 'head', cmd: 'toggleHeaderRow', toggle: true },
  { id: 'headerCol', group: 'head', cmd: 'toggleHeaderColumn', toggle: true },
  { id: 'tableDelete', group: 'table', cmd: 'deleteTable', danger: true },
]

/**
 * 当前上下文下各操作是否可用。
 *   can(cmd)   —— 编辑器的 can()[cmd]() 结果
 *   inHeader   —— 光标是否在表头行(第一行且是表头单元格)
 *   rows/cols  —— 表格当前的行数/列数(用于"最后一行/列不能删")
 * 产品规则(库没有):
 *   - 在表头行上"向上加行"会把新行加到表头之前、表头被挤成第二行,反直觉,禁用。
 *   - 其余按库的 can() 判断(只剩一行/一列时删除不可用、光标在表格外全部不可用)。
 */
export function actionStates(can, { inHeader = false, inTable = true, rows = 2, cols = 2 } = {}) {
  const out = {}
  for (const a of TABLE_ACTIONS) {
    let ok = inTable && !!can(a.cmd)
    if (a.id === 'rowBefore' && inHeader) ok = false
    // 库的 can() 对"最后一列"误报可用(执行后什么都不发生),所以这里按实际行列数补上:
    //   只剩 1 列 → 不能删列;只剩 1 行 → 不能删行。(想整个删掉请用"删除表格")
    if (a.id === 'colDelete' && cols <= 1) ok = false
    if (a.id === 'rowDelete' && rows <= 1) ok = false
    out[a.id] = ok
  }
  return out
}

/** 从简化的行结构(同 headerState 的入参)得到行数、列数(取最大列数,合并单元格按单元格个数计,足够判断"是否只剩一个")。 */
export function tableDims(rows) {
  const r = Array.isArray(rows) ? rows.filter((x) => Array.isArray(x)) : []
  return { rows: r.length, cols: r.reduce((m, x) => Math.max(m, x.length), 0) }
}

/** 工具条显示的位置:表格上沿之上居中;上方放不下就放表格下沿之下;横向夹在视口内。 */
export function toolbarPosition(tableRect, size, viewport, gap = 8) {
  const w = size.w, h = size.h
  let left = tableRect.left + tableRect.width / 2 - w / 2
  left = Math.max(gap, Math.min(left, viewport.w - w - gap))
  let top = tableRect.top - h - gap
  let side = 'above'
  if (top < gap) {
    top = tableRect.bottom + gap
    side = 'below'
    if (top + h > viewport.h - gap) { top = Math.max(gap, Math.min(viewport.h - h - gap, tableRect.top + gap)); side = 'inside' }
  }
  return { left: Math.round(left), top: Math.round(top), side }
}

/** 表格在视口里是否至少部分可见(完全滚出可视区时不显示工具条,避免悬在空白处)。 */
export function tableVisible(tableRect, viewport) {
  return tableRect.bottom > 0 && tableRect.top < viewport.h && tableRect.right > 0 && tableRect.left < viewport.w
}

/**
 * 表头状态:第一行全是表头单元格 → 有表头行;每一行的第一格都是表头单元格(且至少 2 行)→ 有表头列。
 * 入参是 Tiptap/ProseMirror 的简化结构:rows = [[ 'tableHeader'|'tableCell', ... ], ...]。
 * (不能只看左上角那一格:左上角在"表头行 + 表头列"同时存在时也是表头,会把两者混淆。)
 */
export function headerState(rows) {
  const r = Array.isArray(rows) ? rows.filter((x) => Array.isArray(x) && x.length) : []
  if (!r.length) return { row: false, col: false }
  const row = r[0].every((t) => t === 'tableHeader')
  // 表头列:除去第一行(它可能是表头行)后,其余每行的第一格都是表头;只有一行时看那一行的第一格以外是否全是表头不成立,按 false
  const body = r.slice(1)
  const col = body.length > 0 && body.every((x) => x[0] === 'tableHeader')
  return { row, col }
}
