// 图形节点:SVG 轮廓 + 居中文字。双击编辑文字(多行纯文本)。

import React from 'react'
import { shapeGeometry, DASHES } from '../core/shapes.js'
import { shapeFill, shapeStroke } from './colors.js'

const h = React.createElement

export function ShapeBody({ n, editing, store, t }) {
  const isText = n.kind === 'text'
  const g = isText ? null : shapeGeometry(n.kind, n.width, n.height)
  const sw = n.strokeWidth ?? 1.5
  const fs = n.fontSize ?? (isText ? 16 : 14)
  const align = n.align ?? 'center'
  const area = isText ? { x: 4, y: 2, w: Math.max(1, n.width - 8), h: Math.max(1, n.height - 4) } : g.text

  const ref = React.useRef(null)
  React.useEffect(() => {
    if (!editing || !ref.current) return
    const el = ref.current
    autoGrow(el)
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])
  const commit = (v) => {
    store.setEditing(null)
    if (v !== (n.text || '')) store.dispatch([{ op: 'updateNode', id: n.id, patch: { text: v } }])
    // 新建的独立文本什么都没写:丢弃
    else if (isText && !v.trim()) store.dispatch([{ op: 'removeNodes', ids: [n.id] }])
  }
  const textStyle = {
    left: area.x, top: area.y, width: area.w, height: area.h, fontSize: fs, textAlign: align,
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    color: n.color ? shapeStroke(n.color) : undefined,
  }
  return h(React.Fragment, null,
    g ? h('svg', { className: 'wb-shape-svg', width: n.width, height: n.height, viewBox: `0 0 ${n.width} ${n.height}`, overflow: 'visible', 'aria-hidden': true },
      h('path', { d: g.d, fill: shapeFill(n.fill ?? 'none'), stroke: shapeStroke(n.stroke ?? 'default'), strokeWidth: sw, strokeDasharray: DASHES[n.dash ?? 'solid'], strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }),
      g.extra ? h('path', { d: g.extra, fill: 'none', stroke: shapeStroke(n.stroke ?? 'default'), strokeWidth: sw, strokeDasharray: DASHES[n.dash ?? 'solid'], vectorEffect: 'non-scaling-stroke' }) : null) : null,
    editing
      ? h('div', { className: 'wb-shape-text', style: textStyle }, h('textarea', {
        ref, className: 'wb-shape-input', defaultValue: n.text || '', rows: 1, placeholder: isText ? t('shape.textPlaceholder') : '',
        style: { textAlign: align, width: '100%' },
        onInput: (e) => autoGrow(e.currentTarget),
        onPointerDown: (e) => e.stopPropagation(),
        onKeyDown: (e) => {
          e.stopPropagation()
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commit(e.currentTarget.value) }
        },
        onBlur: (e) => commit(e.currentTarget.value),
      }))
      : h('div', { className: 'wb-shape-text', style: textStyle }, n.text || (isText ? h('span', { className: 'wb-placeholder' }, t('shape.textPlaceholder')) : null)))
}

function autoGrow(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, el.parentElement?.clientHeight || el.scrollHeight) + 'px'
}
