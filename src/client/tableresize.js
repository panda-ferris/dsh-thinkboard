// 表格列宽拖拽:基于 prosemirror-tables 的 columnResizing(悬停识别列边界、画手柄),
// 但接管 mousedown 之后的拖动,原因:
//   1) 库把"屏幕像素位移"直接当列宽增量;表格处在被缩放的画布里时(transform: scale),
//      手柄会落后或超前于鼠标。这里按画布缩放比例换算(draggedColWidth)。
//   2) 需要"双击列边界恢复自动宽度"。
//
// 列宽存在单元格的 colwidth 属性里(world 单位的像素)。存盘格式见 core/tablemd.js:
// 有手动列宽的表格存成 HTML(GFM 没有地方存宽度),没有则仍是 GFM。

import { Extension } from '@tiptap/core'
import { columnResizing, columnResizingPluginKey, TableMap, updateColumnsOnResize } from '@tiptap/pm/tables'
import { draggedColWidth, COL_MIN } from '../core/tablemd.js'

/** 取单元格所在列(考虑 colspan,取最右一列)的当前宽度,单位 world px。 */
function currentWidth(view, cellPos) {
  const cell = view.state.doc.nodeAt(cellPos)
  const w = cell.attrs.colwidth && cell.attrs.colwidth[cell.attrs.colwidth.length - 1]
  if (w) return w
  const dom = view.domAtPos(cellPos).node.childNodes[view.domAtPos(cellPos).offset]
  const parts = cell.attrs.colspan || 1
  let width = dom.offsetWidth
  let left = parts
  if (cell.attrs.colwidth) for (let i = 0; i < parts; i++) if (cell.attrs.colwidth[i]) { width -= cell.attrs.colwidth[i]; left-- }
  return width / Math.max(1, left)
}

/** 把整列(所有行里落在该列的单元格)的宽度写成 width;width 为 0 表示清除手动宽度。 */
export function setColumnWidth(view, cellPos, width) {
  const $cell = view.state.doc.resolve(cellPos)
  const table = $cell.node(-1), map = TableMap.get(table), start = $cell.start(-1)
  const col = map.colCount($cell.pos - start) + $cell.nodeAfter.attrs.colspan - 1
  const tr = view.state.tr
  for (let row = 0; row < map.height; row++) {
    const idx = row * map.width + col
    if (row && map.map[idx] === map.map[idx - map.width]) continue   // 被上方合并单元格占用
    const pos = map.map[idx]
    const attrs = table.nodeAt(pos).attrs
    const i = attrs.colspan === 1 ? 0 : col - map.colCount(pos)
    const next = attrs.colwidth ? attrs.colwidth.slice() : Array(attrs.colspan).fill(0)
    if ((next[i] || 0) === width) continue
    next[i] = width
    tr.setNodeMarkup(start + pos, null, { ...attrs, colwidth: next.some((x) => x > 0) ? next : null })
  }
  if (tr.docChanged) view.dispatch(tr)
}

/** 画布缩放比例:屏幕像素 / world 像素(无缩放时为 1)。从表格自身量:渲染宽 / 布局宽。 */
function scaleOf(tableEl) {
  const w = tableEl.offsetWidth
  const s = w > 0 ? tableEl.getBoundingClientRect().width / w : 1
  return Number.isFinite(s) && s > 0 ? s : 1
}

export const ColumnWidth = Extension.create({
  name: 'wbColumnWidth',
  addProseMirrorPlugins() {
    const plugin = columnResizing({ handleWidth: 6, cellMinWidth: COL_MIN, defaultCellMinWidth: COL_MIN, View: null, lastColumnResizable: true })
    const dom = plugin.props.handleDOMEvents

    dom.mousedown = (view, event) => {
      if (!view.editable || event.button !== 0) return false
      const st = columnResizingPluginKey.getState(view.state)
      if (!st || st.activeHandle < 0 || st.dragging) return false
      const cellPos = st.activeHandle
      let tableEl = view.domAtPos(cellPos).node
      while (tableEl && tableEl.nodeName !== 'TABLE') tableEl = tableEl.parentNode
      if (!tableEl) return false
      const scale = scaleOf(tableEl)
      const startWidth = currentWidth(view, cellPos)
      const startX = event.clientX
      const win = view.dom.ownerDocument.defaultView || window
      view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX, startWidth } }))
      const colOf = () => {
        const $cell = view.state.doc.resolve(cellPos)
        const table = $cell.node(-1), start = $cell.start(-1)
        return { table, col: TableMap.get(table).colCount($cell.pos - start) + $cell.nodeAfter.attrs.colspan - 1 }
      }
      const live = (e) => {
        const { table, col } = colOf()
        updateColumnsOnResize(table, tableEl.firstChild, tableEl, COL_MIN, col, draggedColWidth(startWidth, e.clientX - startX, scale))
      }
      const move = (e) => { if (!e.which) return finish(e); live(e) }
      const finish = (e) => {
        win.removeEventListener('mousemove', move); win.removeEventListener('mouseup', finish)
        const cur = columnResizingPluginKey.getState(view.state)
        if (cur && cur.dragging) {
          setColumnWidth(view, cur.activeHandle, draggedColWidth(startWidth, e.clientX - startX, scale))
          view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }))
        }
      }
      live(event)
      win.addEventListener('mousemove', move); win.addEventListener('mouseup', finish)
      event.preventDefault()
      return true
    }

    // 双击列边界:清除该列的手动宽度,恢复自动
    dom.dblclick = (view, event) => {
      if (!view.editable) return false
      const st = columnResizingPluginKey.getState(view.state)
      if (!st || st.activeHandle < 0) return false
      setColumnWidth(view, st.activeHandle, 0)
      event.preventDefault()
      return true
    }
    return [plugin]
  },
})
