// 表格浮动工具条:光标在表格里时,悬在表格上方(放不下则下方)。
// 为什么渲染到 <body>:白板画布用 transform 做平移/缩放,fixed 定位的元素放在画布里会相对画布而不是窗口。
// 为什么按钮 mousedown 要 preventDefault:否则点按钮会让编辑器失焦,卡片的"离开即提交"逻辑会误判为离开。

import React from 'react'
import { createPortal } from 'react-dom'
import { TABLE_ACTIONS, actionStates, toolbarPosition, tableVisible, headerState, tableDims } from '../core/tabletools.js'

const h = React.createElement

const I = (d) => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...d)
const P = (key, d) => h('path', { key, d })
const ICONS = {
  rowBefore: () => I([h('rect', { key: 1, x: 2.5, y: 8, width: 11, height: 5.5, rx: 1 }), P(2, 'M8 2.500v3.500M6.200 4.200H9.800')]),
  rowAfter: () => I([h('rect', { key: 1, x: 2.5, y: 2.5, width: 11, height: 5.5, rx: 1 }), P(2, 'M8 10v3.500M6.200 11.800H9.800')]),
  rowDelete: () => I([h('rect', { key: 1, x: 2.5, y: 5.500, width: 11, height: 5, rx: 1 }), P(2, 'M6 8h4')]),
  colBefore: () => I([h('rect', { key: 1, x: 8, y: 2.5, width: 5.5, height: 11, rx: 1 }), P(2, 'M2.500 8H6M4.200 6.200v3.600')]),
  colAfter: () => I([h('rect', { key: 1, x: 2.5, y: 2.5, width: 5.5, height: 11, rx: 1 }), P(2, 'M10 8h3.500M11.800 6.200v3.600')]),
  colDelete: () => I([h('rect', { key: 1, x: 5.5, y: 2.5, width: 5, height: 11, rx: 1 }), P(2, 'M8 6v4')]),
  headerRow: () => I([h('rect', { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.500 }), h('path', { key: 2, d: 'M2.500 6h11', strokeWidth: 2.4 }), P(3, 'M8 6v7.500')]),
  headerCol: () => I([h('rect', { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.500 }), h('path', { key: 2, d: 'M6 2.500v11', strokeWidth: 2.4 }), P(3, 'M6 8h7.500')]),
  tableDelete: () => I([P(1, 'M3.500 4.500h9M6.500 4.500V3h3v1.500M4.500 4.500l.5 8h6l.5-8M7 7v3.500M9 7v3.500')]),
}

/**
 * props:
 *   editor — Tiptap 编辑器实例
 *   t      — 翻译
 * 自己根据编辑器选区决定显示与否;监听编辑器更新、窗口滚动/缩放来重新定位。
 */
export function TableToolbar({ editor, t }) {
  const [state, setState] = React.useState(null)       // { pos:{left,top,side}, enabled:{...}, header:{row,col} } | null
  const ref = React.useRef(null)

  const compute = React.useCallback(() => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return setState(null)
    const { $from } = editor.state.selection
    // 光标是否在表格里 / 在表头行里
    let tableDepth = -1, inHeader = false
    for (let d = $from.depth; d > 0; d--) { const n = $from.node(d); if (n.type.name === 'table') { tableDepth = d; break } }
    if (tableDepth < 0) return setState(null)
    for (let d = $from.depth; d > tableDepth; d--) {
      const n = $from.node(d)
      if (n.type.name === 'tableRow') { inHeader = $from.index(tableDepth) === 0 && n.firstChild?.type.name === 'tableHeader'; break }
    }
    const tableDom = editor.view.nodeDOM($from.before(tableDepth))
    const el = tableDom && (tableDom.nodeName === 'TABLE' ? tableDom : tableDom.querySelector?.('table'))
    if (!el) return setState(null)
    const r = el.getBoundingClientRect()
    const vp = { w: window.innerWidth, h: window.innerHeight }
    if (!tableVisible(r, vp)) return setState(null)
    const size = ref.current ? { w: ref.current.offsetWidth, h: ref.current.offsetHeight } : { w: 330, h: 40 }
    const can = (cmd) => { try { return !!editor.can()[cmd]() } catch { return false } }
    const rows = []
    $from.node(tableDepth).forEach((row) => { const cells = []; row.forEach((cell) => cells.push(cell.type.name)); rows.push(cells) })
    const dims = tableDims(rows)
    const enabled = actionStates(can, { inHeader, inTable: true, rows: dims.rows, cols: dims.cols })
    setState({ pos: toolbarPosition({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, size, vp), enabled, header: headerState(rows) })
  }, [editor])

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    let raf = 0
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute) }
    editor.on('selectionUpdate', schedule); editor.on('update', schedule); editor.on('focus', schedule); editor.on('blur', schedule)
    // 画布平移/缩放/窗口变化后表格的屏幕位置会变:捕获阶段监听所有滚动,并轮询 transform 变化(画布缩放不触发 scroll)
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    const tick = setInterval(schedule, 250)
    schedule()
    return () => { cancelAnimationFrame(raf); clearInterval(tick); editor.off('selectionUpdate', schedule); editor.off('update', schedule); editor.off('focus', schedule); editor.off('blur', schedule); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [editor, compute])

  // 渲染后量出真实尺寸再重算一次位置(第一次用估计值)
  React.useLayoutEffect(() => { if (state && ref.current) { const w = ref.current.offsetWidth, hh = ref.current.offsetHeight; if (Math.abs(w - 330) > 2 || Math.abs(hh - 40) > 2) compute() } }, [state?.pos?.left, state?.pos?.top])

  if (!state) return null
  const run = (a) => {
    if (!state.enabled[a.id]) return
    editor.chain().focus()[a.cmd]().run()
  }
  const label = (a) => t('tbl.' + a.id)
  let lastGroup = null
  const children = []
  TABLE_ACTIONS.forEach((a) => {
    if (lastGroup && a.group !== lastGroup) children.push(h('span', { key: 'sep-' + a.id, className: 'wb-tbltool-sep', 'aria-hidden': true }))
    lastGroup = a.group
    const on = a.id === 'headerRow' ? state.header.row : a.id === 'headerCol' ? state.header.col : false
    children.push(h('button', {
      key: a.id, type: 'button', className: 'wb-tbltool-btn' + (a.danger ? ' is-danger' : '') + (on ? ' is-on' : ''), disabled: !state.enabled[a.id],
      title: label(a), 'aria-label': label(a), 'aria-pressed': a.toggle ? on : undefined, 'data-tbl-action': a.id,
      onMouseDown: (e) => { e.preventDefault() },      // 不让编辑器失焦
      onClick: () => run(a),
    }, ICONS[a.id]()))
  })
  return createPortal(h('div', {
    ref, className: 'wb-tbltool', role: 'toolbar', 'aria-label': t('tbl.title'), 'data-wb-ui': true, 'data-side': state.pos.side,
    style: { left: state.pos.left, top: state.pos.top },
    onMouseDown: (e) => { e.preventDefault() },
  }, children), document.body)
}
