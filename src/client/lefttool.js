// 左侧竖向工具栏(对标飞书画板):选择 / 图形(弹层)/ 文本 / 卡片 / 框。
// 选中某个工具后进入"放置模式":在画布上点击放置(默认大小)或拖拽画出大小;Esc 退出。

import React from 'react'
import { SHAPE_KINDS, shapeGeometry } from '../core/shapes.js'

const h = React.createElement

function ShapeThumb({ kind, size = 22 }) {
  const w = 30, hgt = 22
  const g = shapeGeometry(kind, w, hgt)
  return h('svg', { width: size * (w / hgt), height: size, viewBox: `-1.5 -1.5 ${w + 3} ${hgt + 3}`, 'aria-hidden': true },
    h('path', { d: g.d, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
    g.extra ? h('path', { d: g.extra, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }) : null)
}

const I = {
  select: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }, h('path', { d: 'M3 2l9 5.2-4 1.1 2.4 4.4-1.6.9-2.4-4.4L3.4 12z' })),
  shape: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, h('rect', { x: 2, y: 6, width: 8, height: 8, rx: 1 }), h('circle', { cx: 11, cy: 5, r: 3.2 })),
  text: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }, h('path', { d: 'M3 3.5h10M8 3.5v10' })),
  card: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }, h('path', { d: 'M3 2.5h10v7l-4 4H3z' }), h('path', { d: 'M9 13.5v-4h4' })),
  group: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 2, strokeDasharray: '2 1.6' }), h('path', { d: 'M4.5 5.5h4' })),
  image: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }, h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }), h('circle', { cx: 5.6, cy: 6.6, r: 1.2 }), h('path', { d: 'M2.5 12l3.6-3.4 2.4 2.2 2-1.8 3 3' })),
  html: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3.5L7 12.5' })),
  undo: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M5.5 3.5L2.5 6.5l3 3M3 6.5h6.2a3.8 3.8 0 010 7.6H6' })),
  redo: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M10.5 3.5l3 3-3 3M13 6.5H6.8a3.8 3.8 0 000 7.6H10' })),
  fit: () => h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10' })),
}

export function LeftToolbar({ tool, setTool, t, onAddGroup, onAddImage, onAddHtml, onUndo, onRedo, onFit, canUndo, canRedo }) {
  const [open, setOpen] = React.useState(false)
  const [last, setLast] = React.useState('roundRect')
  const ref = React.useRef(null)
  React.useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])
  const is = (k) => (k === 'select' ? !tool : tool?.kind === k)
  const btn = (key, title, onClick, icon) => h('button', {
    key, className: 'wb-lt-btn' + (is(key) ? ' is-on' : ''), title, 'aria-label': title, 'aria-pressed': is(key), onClick,
  }, icon)
  const act = (key, title, onClick, icon, disabled) => h('button', { key, className: 'wb-lt-btn', title, 'aria-label': title, disabled, onClick: () => { onClick(); setOpen(false) } }, icon)
  return h('div', { ref, className: 'wb-lefttool-wrap', 'data-wb-ui': true, onPointerDown: (e) => e.stopPropagation() },
    h('div', { className: 'wb-lefttool', role: 'toolbar', 'aria-orientation': 'vertical', 'aria-label': t('tool.panel') },
    // —— 选择 ——
    btn('select', t('tool.select'), () => { setTool(null); setOpen(false) }, I.select()),
    h('div', { className: 'wb-lt-sep' }),
    // —— 添加元素 ——
    h('button', {
      className: 'wb-lt-btn' + (is('shape') ? ' is-on' : ''), title: t('tool.shape'), 'aria-label': t('tool.shape'), 'aria-expanded': open,
      onClick: () => setOpen((v) => !v),
    }, tool?.kind === 'shape' ? h(ShapeThumb, { kind: tool.shape, size: 14 }) : I.shape()),
    btn('text', t('tool.textBox'), () => { setTool({ kind: 'text' }); setOpen(false) }, I.text()),
    btn('card', t('tool.cardTool'), () => { setTool({ kind: 'card' }); setOpen(false) }, I.card()),
    act('image', t('tool.image'), onAddImage, I.image()),
    act('html', t('tool.htmlHint'), onAddHtml, I.html()),
    act('group', t('tool.group'), onAddGroup, I.group()),
    h('div', { className: 'wb-lt-sep' }),
    // —— 操作 ——
    act('undo', t('tool.undo') + ' (⌘Z)', onUndo, I.undo(), !canUndo),
    act('redo', t('tool.redo') + ' (⌘⇧Z)', onRedo, I.redo(), !canRedo),
    act('fit', t('tool.fit'), onFit, I.fit())),
    open ? h('div', { className: 'wb-shape-pop', role: 'menu' },
      h('div', { className: 'wb-shape-grid' },
        SHAPE_KINDS.map((k) => h('button', {
          key: k, role: 'menuitem', className: 'wb-shape-cell' + (tool?.shape === k ? ' is-on' : ''), title: t('shape.' + k), 'aria-label': t('shape.' + k), 'data-shape': k,
          onClick: () => { setLast(k); setTool({ kind: 'shape', shape: k }); setOpen(false) },
          // 拖到画布上直接放置
          draggable: true,
          onDragStart: (e) => { e.dataTransfer.setData('application/x-wb-shape', k); e.dataTransfer.effectAllowed = 'copy' },
        }, h(ShapeThumb, { kind: k })))),
      h('div', { className: 'wb-shape-hint' }, t('shape.hint'))) : null)
}
