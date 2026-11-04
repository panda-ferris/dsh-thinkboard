// 悬浮层:叠在画布之上,不占布局空间,所以出现/消失/换内容都不会让画布跳动。
//   - ContextBar : 跟随选中对象的上下文工具条(排版、颜色、连线样式、成框、适配)
//   - SearchBox  : ⌘F 搜索,结果列表点击后定位到对应元素
//   - Minimap    : 右下角小地图,点击/拖动可平移

import React from 'react'
import { COLOR_NAMES, COLORS, FILL_CHOICES, STROKE_CHOICES, shapeFill, shapeStroke } from './colors.js'
import { FONT_SIZES } from '../core/shapes.js'
import { edgeEnds } from '../core/edges.js'
import { Icon } from './icons.js'
import { alignOps, distributeOps, fitGroupOps, wrapInGroupOps, topLevel, layoutUnits } from '../core/arrange.js'
import { groupOps, ungroupOps, clusterPath, expandToUnits } from '../core/cluster.js'
import { uid } from '../core/model.js'
import { restoreRatioPatch, togglePatch } from '../core/content.js'
import { placeFloating, worldToScreen, searchBoard, focusViewport, minimapLayout, toMap, viewportFromMap, viewportWorldRect } from '../core/view.js'

const h = React.createElement

/** 画布容器尺寸;随窗口变化更新。 */
export function useSize(ref) {
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

// ---------------- 上下文工具条 ----------------
/** 选择 → 目标矩形(world)。节点用外包盒;连线用两端中点的外包盒。 */
export function selectionRect(board, selection, edgeId) {
  const nodes = board.nodes.filter((n) => selection.includes(n.id))
  if (nodes.length) {
    const x1 = Math.min(...nodes.map((n) => n.x)), y1 = Math.min(...nodes.map((n) => n.y))
    const x2 = Math.max(...nodes.map((n) => n.x + n.width)), y2 = Math.max(...nodes.map((n) => n.y + n.height))
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  if (edgeId) {
    const e = board.edges.find((x) => x.id === edgeId)
    const a = e && board.nodes.find((n) => n.id === e.fromNode), b = e && board.nodes.find((n) => n.id === e.toNode)
    if (a && b) {
      const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) || 1, h: Math.abs(ay - by) || 1 }
    }
  }
  return null
}

export function ContextBar({ store, state, size, t, dragging, transport, onReplaceImage, onPreview }) {
  const { board, selection, edgeSelection, viewport, editing } = state
  const ref = React.useRef(null)
  const [dim, setDim] = React.useState({ w: 320, h: 40 })
  const rect = selectionRect(board, selection, edgeSelection)
  const sel = board.nodes.filter((n) => selection.includes(n.id))
  const scope = state.scope || []
  const flat = layoutUnits(board, selection, scope)
  const canGroup = groupOps(board, selection, 'tmp', scope).length > 0
  const canUngroup = ungroupOps(board, selection, scope).length > 0
  const one = sel.length === 1 ? sel[0] : null
  const edge = edgeSelection ? board.edges.find((e) => e.id === edgeSelection) : null

  const run = (ops) => { if (ops.length) store.dispatch(ops) }
  const wrap = () => { const id = uid('g'); run(wrapInGroupOps(board, selection, id)); store.select([id]) }
  const A = (mode) => () => run(alignOps(board, selection, mode, scope))
  const D = (axis) => () => run(distributeOps(board, selection, axis, scope))
  const doGroup = () => { const ops = groupOps(board, selection, uid('c'), scope); if (ops.length) run(ops) }
  const doUngroup = () => run(ungroupOps(board, selection, scope))
  const btn = (key, fn, disabled) => h('button', { key, className: 'wb-btn wb-btn-icon', title: t('arrange.' + key), 'aria-label': t('arrange.' + key), disabled, onClick: fn }, h(Icon, { name: key }))
  const swatches = (current, set) => h('span', { className: 'wb-swatches' }, COLOR_NAMES.map((c) => h('button', { key: c, title: c, className: 'wb-swatch' + (current === c ? ' is-on' : ''), style: { background: COLORS[c].dot }, onClick: () => set(c) })))

  const parts = []
  const shapes = sel.filter((n) => n.type === 'shape')
  const shapeOnly = sel.length > 0 && shapes.length === sel.length
  const patchShapes = (p) => run(shapes.map((n) => ({ op: 'updateNode', id: n.id, patch: p })))
  if (shapeOnly) {
    const f = shapes[0]
    const isText = shapes.every((n) => n.kind === 'text')
    if (!isText) parts.push(h(Pop, { key: 'fill', label: t('style.fill'), icon: h('span', { className: 'wb-chip', style: { background: shapeFill(f.fill ?? 'none') } }) },
      h(ColorGrid, { choices: FILL_CHOICES, value: f.fill ?? 'none', render: shapeFill, onPick: (c) => patchShapes({ fill: c === 'none' ? null : c }), t })))
    if (!isText) parts.push(h(Pop, { key: 'stroke', label: t('style.stroke'), icon: h('span', { className: 'wb-chip wb-chip-ring', style: { borderColor: shapeStroke(f.stroke ?? 'default') } }) },
      h(ColorGrid, { choices: STROKE_CHOICES, value: f.stroke ?? 'default', render: shapeStroke, onPick: (c) => patchShapes({ stroke: c === 'default' ? null : c }), t }),
      h('div', { className: 'wb-pop-row' },
        ['solid', 'dashed', 'dotted'].map((d) => h('button', { key: d, className: 'wb-btn' + ((f.dash ?? 'solid') === d ? ' is-on' : ''), onClick: () => patchShapes({ dash: d === 'solid' ? null : d }) }, t('style.' + d)))),
      h('div', { className: 'wb-pop-row' },
        [1, 1.5, 2.5, 4].map((w) => h('button', { key: w, className: 'wb-btn' + ((f.strokeWidth ?? 1.5) === w ? ' is-on' : ''), title: String(w), onClick: () => patchShapes({ strokeWidth: w === 1.5 ? null : w }) },
          h('span', { className: 'wb-linew', style: { height: w } }))))))
    parts.push(h(Pop, { key: 'text', label: t('style.text'), icon: h('span', { className: 'wb-aa' }, 'A') },
      h('div', { className: 'wb-pop-row' },
        FONT_SIZES.map((fs) => h('button', { key: fs, className: 'wb-btn' + ((f.fontSize ?? (f.kind === 'text' ? 16 : 14)) === fs ? ' is-on' : ''), onClick: () => patchShapes({ fontSize: fs }) }, String(fs)))),
      h('div', { className: 'wb-pop-row' },
        ['left', 'center', 'right'].map((a) => h('button', { key: a, className: 'wb-btn' + ((f.align ?? 'center') === a ? ' is-on' : ''), onClick: () => patchShapes({ align: a === 'center' ? null : a }) }, t('style.align.' + a)))),
      h(ColorGrid, { choices: ['default', ...COLOR_NAMES], value: f.color ?? 'default', render: (c) => (c === 'default' ? 'var(--dsw-alias-label-primary)' : shapeStroke(c)), onPick: (c) => patchShapes({ color: c === 'default' ? null : c }), t })))
  }
  if (flat.length >= 2) {
    parts.push(
      h('span', { key: 'a1', className: 'wb-arrange-group' }, btn('left', A('left')), btn('hcenter', A('hcenter')), btn('right', A('right'))),
      h('span', { key: 'a2', className: 'wb-arrange-group' }, btn('top', A('top')), btn('vcenter', A('vcenter')), btn('bottom', A('bottom'))),
      h('span', { key: 'a3', className: 'wb-arrange-group' }, btn('distX', D('x'), flat.length < 3), btn('distY', D('y'), flat.length < 3)),
      h('button', { key: 'w', className: 'wb-btn wb-btn-label', title: t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' }), t('arrange.wrap')))
  } else if (one && one.type === 'group') {
    parts.push(
      h('button', { key: 'fit', className: 'wb-btn wb-btn-label', title: t('arrange.fit'), onClick: () => run(fitGroupOps(board, one.id)) }, h(Icon, { name: 'fit' }), t('arrange.fit')),
      swatches(one.color, (c) => run([{ op: 'updateNode', id: one.id, patch: { color: c } }])))
  } else if (one && one.type === 'shape') {
    parts.push(h('button', { key: 'w', className: 'wb-btn wb-btn-icon', title: t('arrange.wrap'), 'aria-label': t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' })))
  } else if (one && one.type === 'image') {
    const ratio = restoreRatioPatch(one, one.caption ? 28 : 0)
    parts.push(
      h('button', { key: 'pv', className: 'wb-btn wb-btn-icon', title: t('image.preview'), 'aria-label': t('image.preview'), onClick: () => onPreview?.(one) }, h(Icon, { name: 'expand' })),
      h('button', { key: 'rp', className: 'wb-btn wb-btn-icon', title: t('image.replace'), 'aria-label': t('image.replace'), onClick: () => onReplaceImage?.(one) }, h(Icon, { name: 'replace' })),
      h('button', { key: 'rt', className: 'wb-btn wb-btn-icon', title: t('image.ratio'), 'aria-label': t('image.ratio'), disabled: !ratio, onClick: () => ratio && run([{ op: 'updateNode', id: one.id, patch: ratio }]) }, h(Icon, { name: 'ratio' })),
      h('button', { key: 'cp', className: 'wb-btn wb-btn-icon', title: t('image.caption'), 'aria-label': t('image.caption'), onClick: () => store.setEditing(one.id) }, h(Icon, { name: 'caption' })),
      h('button', { key: 'w', className: 'wb-btn wb-btn-label', title: t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' }), t('arrange.wrap')))
  } else if (one && one.type === 'html') {
    parts.push(
      h('button', { key: 'ed', className: 'wb-btn wb-btn-label', title: t('html.edit'), onClick: () => store.setEditing(one.id) }, h(Icon, { name: 'html' }), t('html.edit')),
      h('button', { key: 'w', className: 'wb-btn wb-btn-label', title: t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' }), t('arrange.wrap')))
  } else if (one && one.type === 'text') {
    parts.push(
      h('button', { key: 'dt', className: 'wb-btn wb-btn-label', title: t('detail.open'), onClick: () => store.openDetail(one.id) }, h(Icon, { name: 'detail' }), t('detail.open')),
      h('button', { key: 'fd', className: 'wb-btn wb-btn-icon', title: one.collapsed ? t('fold.expand') : t('fold.collapse'), 'aria-label': one.collapsed ? t('fold.expand') : t('fold.collapse'), onClick: () => { const p = togglePatch(one); if (p) run([{ op: 'updateNode', id: one.id, patch: p }]) } }, h(Icon, { name: one.collapsed ? 'unfold' : 'fold' })),
      h('button', { key: 'w', className: 'wb-btn wb-btn-label', title: t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' }), t('arrange.wrap')))
  } else if (one) {
    parts.push(h('button', { key: 'w', className: 'wb-btn wb-btn-label', title: t('arrange.wrap'), onClick: wrap }, h(Icon, { name: 'wrap' }), t('arrange.wrap')))
  } else if (edge) {
    const patch = (p) => run([{ op: 'updateEdge', id: edge.id, patch: p }])
    const en = edgeEnds(edge)
    const route = edge.route || 'curve'
    const setEnds = (p) => patch({ arrow: null, ...p })
    parts.push(
      h('span', { key: 'rt', className: 'wb-arrange-group' },
        ['curve', 'orthogonal', 'straight'].map((r) => h('button', { key: r, className: 'wb-btn wb-btn-icon' + (route === r ? ' is-on' : ''), title: t('edge.route.' + r), 'aria-label': t('edge.route.' + r), 'aria-pressed': route === r, onClick: () => patch({ route: r === 'curve' ? null : r }) }, h(Icon, { name: 'route-' + r })))),
      h(Pop, { key: 'ends', label: t('edge.ends'), icon: h(Icon, { name: 'ends' }) },
        h('div', { className: 'wb-pop-label' }, t('edge.start')),
        h('div', { className: 'wb-pop-row' }, ['none', 'arrow', 'dot'].map((v) => h('button', { key: v, className: 'wb-btn' + (en.start === v ? ' is-on' : ''), onClick: () => setEnds({ startEnd: v === 'none' ? null : v, endEnd: en.end }) }, t('edge.end.' + v)))),
        h('div', { className: 'wb-pop-label' }, t('edge.endLabel')),
        h('div', { className: 'wb-pop-row' }, ['none', 'arrow', 'dot'].map((v) => h('button', { key: v, className: 'wb-btn' + (en.end === v ? ' is-on' : ''), onClick: () => setEnds({ endEnd: v, startEnd: en.start === 'none' ? null : en.start }) }, t('edge.end.' + v))))),
      h('button', { key: 'd', className: 'wb-btn' + (edge.dashed ? ' is-on' : ''), onClick: () => patch({ dashed: edge.dashed ? null : true }) }, t('edge.dashed')),
      swatches(edge.color, (c) => patch({ color: c })))
  }
  // 组合 / 取消组合(对任何选择生效,只要语义成立)
  if (!edge && (canGroup || canUngroup)) {
    parts.push(h('span', { key: 'grp', className: 'wb-arrange-group' },
      h('button', { className: 'wb-btn wb-btn-icon', title: t('cluster.group') + ' (⌘G)', 'aria-label': t('cluster.group'), disabled: !canGroup, onClick: doGroup }, h(Icon, { name: 'cluster' })),
      h('button', { className: 'wb-btn wb-btn-icon', title: t('cluster.ungroup') + ' (⌘⇧G)', 'aria-label': t('cluster.ungroup'), disabled: !canUngroup, onClick: doUngroup }, h(Icon, { name: 'uncluster' }))))
  }
  // 通用:删除
  if (parts.length || sel.length || edge) {
    parts.push(h('button', { key: 'del', className: 'wb-btn wb-btn-icon wb-danger', title: t('tool.delete'), 'aria-label': t('tool.delete'), onClick: () => {
      const ops = []
      if (edge) ops.push({ op: 'removeEdges', ids: [edge.id] })
      if (sel.length) ops.push({ op: 'removeNodes', ids: expandToUnits(board, selection, scope) })
      run(ops); store.select([])
    } }, h(Icon, { name: 'trash' })))
  }

  // 量尺寸后再定位(内容变了高度/宽度也变)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && (el.offsetWidth !== dim.w || el.offsetHeight !== dim.h)) setDim({ w: el.offsetWidth, h: el.offsetHeight })
  })

  if (!rect || !parts.length || editing || dragging || !size.w) return null
  const target = worldToScreen(rect, viewport)
  const pos = placeFloating(target, dim, { left: 0, top: 0, right: size.w, bottom: size.h }, { gap: 12, margin: 8 })
  return h('div', {
    ref, className: 'wb-ctxbar', 'data-wb-ui': true, 'data-side': pos.side,
    style: { transform: `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)` },
    onPointerDown: (e) => e.stopPropagation(), // 点击浮条不触发画布的取消选择/框选
  }, parts)
}

// ---------------- 搜索 ----------------
export function SearchBox({ store, state, size, t, onClose }) {
  const { board } = state
  const [q, setQ] = React.useState('')
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef(null)
  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const results = React.useMemo(() => searchBoard(board, q), [board, q])
  React.useEffect(() => { setActive(0) }, [q])

  const go = (r) => {
    if (!r) return
    if (r.kind === 'node') {
      const n = board.nodes.find((x) => x.id === r.id)
      if (!n) return
      store.setViewport(focusViewport({ x: n.x, y: n.y, w: n.width, h: n.height }, size))
      store.select([n.id])
    } else {
      const e = board.edges.find((x) => x.id === r.id)
      const rect = e && selectionRect(board, [], e.id)
      if (rect) store.setViewport(focusViewport(rect, size))
      store.select([], r.id)
    }
  }
  const onKey = (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(results[active]) }
  }
  // 实时预览:上下选择时就定位,不用每次回车
  React.useEffect(() => { if (q.trim() && results[active]) go(results[active]) }, [active, q])

  const typeLabel = (r) => (r.kind === 'edge' ? t('search.edge') : r.type === 'group' ? t('search.group') : r.type === 'image' ? t('search.image') : t('search.card'))
  return h('div', { className: 'wb-search-pop', 'data-wb-ui': true, onPointerDown: (e) => e.stopPropagation() },
    h('div', { className: 'wb-search-row' },
      h(Icon, { name: 'search' }),
      h('input', { ref: inputRef, className: 'wb-search-input', value: q, placeholder: t('search.placeholder'), onChange: (e) => setQ(e.target.value), onKeyDown: onKey }),
      q.trim() ? h('span', { className: 'wb-search-count' }, t('search.count', { count: results.length })) : null,
      h('button', { className: 'wb-btn wb-btn-icon', title: t('search.close'), 'aria-label': t('search.close'), onClick: onClose }, '×')),
    q.trim() ? h('div', { className: 'wb-search-list', role: 'listbox' },
      results.length === 0 ? h('div', { className: 'wb-search-empty' }, t('search.none')) : null,
      results.map((r, i) => h('div', {
        key: r.kind + r.id, role: 'option', 'aria-selected': i === active, className: 'wb-search-item' + (i === active ? ' is-active' : ''),
        onMouseEnter: () => setActive(i), onClick: () => go(r),
      },
        h('span', { className: 'wb-search-type' }, typeLabel(r)),
        h('span', { className: 'wb-search-main' },
          r.title ? h('span', { className: 'wb-search-title' }, highlight(r.title, q)) : null,
          r.snippet && r.snippet !== r.title ? h('span', { className: 'wb-search-snippet' }, highlight(r.snippet, q)) : null)))) : null)
}

/** 把命中的词包成 <mark>。 */
export function highlight(text, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || !text) return text
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const parts = String(text).split(new RegExp(`(${esc})`, 'ig'))
  return parts.map((p, i) => (i % 2 ? h('mark', { key: i }, p) : p))
}

// ---------------- 小地图 ----------------
const LS_MM = 'dsh.thinkboard.minimap.v1' // { open }  默认折叠
const readMM = () => { try { return JSON.parse(localStorage.getItem(LS_MM))?.open === true } catch { return false } }

export function Minimap({ store, state, size, t }) {
  const { board, viewport } = state
  const drag = React.useRef(false)
  const [open, setOpenRaw] = React.useState(readMM)
  const setOpen = (v) => { setOpenRaw(v); try { localStorage.setItem(LS_MM, JSON.stringify({ open: v })) } catch { /* 隐私模式 */ } }
  if (!size.w || board.nodes.length === 0) return null
  if (!open) {
    return h('button', { className: 'wb-minimap-toggle', 'data-wb-ui': true, title: t('minimap.open'), 'aria-label': t('minimap.open'), 'aria-expanded': false,
      onPointerDown: (e) => e.stopPropagation(), onClick: () => setOpen(true) }, h(Icon, { name: 'map' }))
  }
  const vpWorld = viewportWorldRect(viewport, size)
  const L = minimapLayout(board, vpWorld)
  const v1 = toMap(L, vpWorld.x, vpWorld.y)
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    store.setViewport(viewportFromMap(L, e.clientX - r.left, e.clientY - r.top, size, viewport.k))
  }
  const byGroupFirst = [...board.nodes].sort((a, b) => (a.type === 'group' ? -1 : 0) - (b.type === 'group' ? -1 : 0))
  return h('div', { className: 'wb-minimap', 'data-wb-ui': true, style: { width: L.w, height: L.h },
    onPointerDown: (e) => { e.stopPropagation(); drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e) },
    onPointerMove: (e) => { if (drag.current) move(e) },
    onPointerUp: (e) => { drag.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已释放 */ } },
  },
    h('svg', { width: L.w, height: L.h, viewBox: `0 0 ${L.w} ${L.h}` },
      byGroupFirst.map((n) => {
        const p = toMap(L, n.x, n.y)
        const sel = state.selection.includes(n.id)
        const color = n.color && COLORS[n.color]
        return h('rect', { key: n.id, x: p.x, y: p.y, width: Math.max(1.5, n.width * L.scale), height: Math.max(1.5, n.height * L.scale), rx: 1,
          className: 'wb-mm-node wb-mm-' + n.type + (sel ? ' is-selected' : ''), style: color && n.type === 'group' ? { fill: color.fill, stroke: color.stroke } : undefined })
      }),
      h('rect', { className: 'wb-mm-view', x: v1.x, y: v1.y, width: Math.max(4, vpWorld.w * L.scale), height: Math.max(4, vpWorld.h * L.scale), rx: 2 })),
    h('button', { className: 'wb-minimap-close', title: t('minimap.close'), 'aria-label': t('minimap.close'), 'aria-expanded': true,
      onPointerDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); setOpen(false) } }, '×'))
}

// ---------------- 图片放大查看 ----------------
export function Lightbox({ src, alt, onClose }) {
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return h('div', { className: 'wb-lightbox', role: 'dialog', 'aria-modal': true, 'data-wb-ui': true, onPointerDown: (e) => { e.stopPropagation(); onClose() } },
    h('img', { src, alt: alt || '', draggable: false, onPointerDown: (e) => e.stopPropagation() }),
    h('button', { className: 'wb-btn wb-btn-icon wb-lightbox-close', 'aria-label': 'close', onClick: onClose }, '×'))
}

// ---------------- 小组件 ----------------
/** 悬浮条里的下拉:点按钮展开一个小面板,点外面关闭。 */
function Pop({ label, icon, children }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  const id = React.useRef(Math.random().toString(36).slice(2))
  React.useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    // 同一时刻只开一个弹层:别的弹层打开时,这个自动关闭
    const other = (e) => { if (e.detail !== id.current) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('wb-pop-open', other)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('wb-pop-open', other) }
  }, [open])
  const toggle = () => {
    if (!open) window.dispatchEvent(new CustomEvent('wb-pop-open', { detail: id.current }))
    setOpen((v) => !v)
  }
  return h('span', { ref, className: 'wb-pop-wrap' },
    h('button', { className: 'wb-btn wb-btn-icon' + (open ? ' is-on' : ''), title: label, 'aria-label': label, 'aria-expanded': open, onClick: toggle }, icon),
    open ? h('div', { className: 'wb-pop', role: 'dialog', 'aria-label': label }, children) : null)
}

function ColorGrid({ choices, value, render, onPick, t }) {
  return h('div', { className: 'wb-colorgrid' }, choices.map((c) => h('button', {
    key: c, title: t('color.' + c), 'aria-label': t('color.' + c), className: 'wb-swatch' + (c === 'none' ? ' is-none' : '') + (value === c ? ' is-on' : ''),
    style: { background: c === 'none' ? undefined : render(c) }, onClick: () => onPick(c),
  })))
}
