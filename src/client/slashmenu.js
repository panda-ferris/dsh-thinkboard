// slash 菜单:悬浮在光标下方的命令列表。展示与键盘交互在这里,命令的具体执行由调用方(编辑器)提供。

import React from 'react'
import { createPortal } from 'react-dom'
import { filterCommands, moveIndex, parseTableSize, clampTableSize, TABLE_DEFAULT, TABLE_MAX_ROWS, TABLE_MAX_COLS } from '../core/slash.js'

const h = React.createElement

const I = (d, extra = {}) => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, ...d)
const ICONS = {
  table: () => I([h('rect', { key: 1, x: 2, y: 3, width: 12, height: 10, rx: 1.5 }), h('path', { key: 2, d: 'M2 7h12M2 10h12M6.5 3v10M10 3v10' })]),
  image: () => I([h('rect', { key: 1, x: 2, y: 3, width: 12, height: 10, rx: 1.5 }), h('circle', { key: 2, cx: 5.6, cy: 6.6, r: 1.2 }), h('path', { key: 3, d: 'M2.5 12l3.6-3.4 2.4 2.2 2-1.8 3 3' })]),
  h1: () => h('span', { className: 'wb-slash-glyph' }, 'H1'),
  h2: () => h('span', { className: 'wb-slash-glyph' }, 'H2'),
  h3: () => h('span', { className: 'wb-slash-glyph' }, 'H3'),
  bullet: () => I([h('circle', { key: 1, cx: 3.5, cy: 4.5, r: 0.9, fill: 'currentColor' }), h('circle', { key: 2, cx: 3.5, cy: 8, r: 0.9, fill: 'currentColor' }), h('circle', { key: 3, cx: 3.5, cy: 11.5, r: 0.9, fill: 'currentColor' }), h('path', { key: 4, d: 'M6.5 4.5h7M6.5 8h7M6.5 11.5h7' })]),
  ordered: () => h('span', { className: 'wb-slash-glyph' }, '1.'),
  task: () => I([h('rect', { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 2 }), h('path', { key: 2, d: 'M5.5 8.2l1.8 1.8 3.2-3.6' })]),
  quote: () => I([h('path', { key: 1, d: 'M3 3.5v9M6.5 5h6.5M6.5 8h6.5M6.5 11h4' })]),
  code: () => I([h('path', { key: 1, d: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5' })]),
  divider: () => I([h('path', { key: 1, d: 'M2 8h12' })]),
}

/** 表格尺寸选择:鼠标划过网格选行列,或在输入框里写 "4x3";回车确认。 */
function TableSizePicker({ t, onPick, onCancel, onRefocus }) {
  const [hover, setHover] = React.useState({ rows: TABLE_DEFAULT.rows, cols: TABLE_DEFAULT.cols })
  const [text, setText] = React.useState('')
  const parsed = parseTableSize(text)
  const shown = parsed ?? hover
  const ref = React.useRef(null)
  React.useEffect(() => { ref.current?.focus() }, [])

  const rows = Math.min(8, TABLE_MAX_ROWS), cols = Math.min(8, TABLE_MAX_COLS)
  return h('div', { className: 'wb-slash-table', 'data-wb-slash-table': true },
    h('div', { className: 'wb-slash-grid', style: { gridTemplateColumns: `repeat(${cols}, 18px)` } },
      Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols) + 1, c = (i % cols) + 1
        const on = r <= shown.rows && c <= shown.cols
        return h('button', { key: i, type: 'button', className: 'wb-slash-cell' + (on ? ' is-on' : ''), 'aria-label': `${r}×${c}`, tabIndex: -1,
          onMouseEnter: () => { setText(''); setHover({ rows: r, cols: c }) },
          // 点网格时尺寸输入框正持有焦点;mousedown 的默认行为被阻止,输入框随后失焦、relatedTarget 为空,
          // 卡片会误判"用户离开了卡片"而提交退出。所以先把焦点交还给编辑器(在卡片内),再插入。
          onMouseDown: (e) => { e.preventDefault(); onRefocus?.(); onPick({ rows: r, cols: c }) } })
      })),
    h('div', { className: 'wb-slash-sizebar' },
      h('input', { ref, className: 'wb-slash-sizeinput', value: text, placeholder: t('slash.sizeHint'), 'aria-label': t('slash.sizeHint'),
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); onRefocus?.(); onPick(parsed ?? clampTableSize(hover.rows, hover.cols)) }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        } }),
      h('span', { className: 'wb-slash-sizelabel' }, t('slash.tableSize', { rows: shown.rows, cols: shown.cols }))))
}

/**
 * 菜单位置。
 *
 * 朝向(放光标下方还是上方)在菜单"打开的那一刻"决定一次,之后整个会话保持不变:
 *   - 按"最大可能高度"(菜单的 max-height,而不是当前候选数对应的高度)判断下方放不放得下。
 *   - 否则输入过滤时候选数变化 → 高度变化 → 朝向来回翻转,菜单上下乱跳。
 * 朝向为"上方"时,菜单用 bottom 对齐光标上沿(而不是 top),这样高度变化只会向上伸缩,不会离开光标。
 * 横向:贴着光标,不超出视口。
 */
const MENU_MAX_HEIGHT = 320 + 14   // 与样式里的 max-height + padding 保持一致
function useClampedPosition(anchor) {
  const ref = React.useRef(null)
  const dir = React.useRef(null)                       // 'down' | 'up',首次渲染后固定
  const [pos, setPos] = React.useState({ left: anchor.left, top: anchor.top, bottom: null })
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth, vw = window.innerWidth, vh = window.innerHeight, gap = 8
    const left = Math.max(gap, Math.min(anchor.left, vw - w - gap))
    if (dir.current === null) dir.current = anchor.top + MENU_MAX_HEIGHT > vh - gap ? 'up' : 'down'
    const next = dir.current === 'down'
      ? { left, top: anchor.top, bottom: null }
      // 向上展开:菜单下沿固定在光标上沿之上 6px;高度变化只向上伸缩
      : { left, top: null, bottom: Math.max(gap, vh - (anchor.caretTop ?? anchor.top) + 6) }
    setPos((p) => (p.left === next.left && p.top === next.top && p.bottom === next.bottom ? p : next))
  })
  return { ref, ...pos }
}

/**
 * props:
 *   query     —— "/" 之后用户输入的文字
 *   anchor    —— { left, top } 菜单位置(相对视口)
 *   t         —— 翻译
 *   onRun(id, extra)  —— 执行命令(extra:表格尺寸)
 *   onClose() —— 关闭菜单(Esc / 没有候选)
 *   keysRef   —— 编辑器把键盘事件转给菜单:keysRef.current(e) 返回 true 表示已处理
 */
export function SlashMenu({ query, anchor, t, onRun, onClose, keysRef, onRefocus }) {
  const items = React.useMemo(() => filterCommands(query, (id) => t('slash.' + id)), [query, t])
  const [index, setIndex] = React.useState(0)
  const [stage, setStage] = React.useState(null) // null | 'table'
  React.useEffect(() => { setIndex(0) }, [query])
  React.useEffect(() => { if (!stage && query !== '' && items.length === 0) onClose() }, [items.length, query, stage])
  const run = (c) => { if (c.id === 'table') setStage('table'); else onRun(c.id) }
  // 键盘:上下选择、回车执行、Esc 关闭;表格尺寸阶段由它自己的输入框接管
  React.useEffect(() => {
    keysRef.current = (e) => {
      if (stage) return false
      if (e.key === 'ArrowDown') { setIndex((i) => moveIndex(i, 1, items.length)); return true }
      if (e.key === 'ArrowUp') { setIndex((i) => moveIndex(i, -1, items.length)); return true }
      if (e.key === 'Enter' || e.key === 'Tab') { if (items[index]) { run(items[index]); return true } return false }
      if (e.key === 'Escape') { onClose(); return true }
      return false
    }
    return () => { keysRef.current = null }
  })
  const listRef = React.useRef(null)
  // 让高亮项保持在菜单列表可见范围内。只改菜单自己的 scrollTop——不能用 scrollIntoView:
  // 它会沿祖先链滚动所有可滚动容器(包括白板画布),导致整张卡片跳动。
  React.useEffect(() => {
    const list = listRef.current, el = list?.querySelector('.is-active')
    if (!list || !el) return
    const top = el.offsetTop, bottom = top + el.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [index])
  // 所有 hook 必须在任何提前返回之前调用,否则两次渲染的 hook 数量不一致,React 会报错 #300 并卸载整棵树
  const pos = useClampedPosition(anchor)
  if (!items.length && !stage) return null
  return createPortal(h('div', { ref: pos.ref, className: 'wb-slash', role: 'listbox', 'aria-label': t('slash.title'), style: pos.top != null ? { left: pos.left, top: pos.top } : { left: pos.left, bottom: pos.bottom }, 'data-wb-ui': true, 'data-wb-slash': true,
    onMouseDown: (e) => e.preventDefault() }, // 点菜单不要让编辑器失去焦点
    stage === 'table'
      ? h(TableSizePicker, { t, onRefocus, onCancel: () => { setStage(null); onRefocus?.() }, onPick: (size) => onRun('table', size) })
      : h('div', { ref: listRef, className: 'wb-slash-list' },
        items.map((c, i) => h('div', { key: c.id, role: 'option', 'aria-selected': i === index, 'data-slash': c.id, className: 'wb-slash-item' + (i === index ? ' is-active' : ''),
          onMouseEnter: () => setIndex(i), onClick: () => run(c) },
          h('span', { className: 'wb-slash-icon' }, (ICONS[c.icon] || ICONS.divider)()),
          h('span', { className: 'wb-slash-name' }, t('slash.' + c.id)),
          h('span', { className: 'wb-slash-desc' }, t('slash.' + c.id + '.desc')))))), document.body)
}
