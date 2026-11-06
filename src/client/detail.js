// 详情面板:在画布右侧完整编辑一张文字卡片(长文写作)。与对话区共用右侧位置,用标签切换。

import React from 'react'
import { LiveMarkdownEditor } from './markdown.js'
import { togglePatch } from '../core/content.js'

const h = React.createElement

export function DetailPane({ store, state, t, transport }) {
  const id = state.detail
  const n = state.board?.nodes.find((x) => x.id === id)
  if (!n) return h('div', { className: 'wb-chat-empty' }, t('detail.empty'))
  if (n.type !== 'text') return h('div', { className: 'wb-chat-empty' }, t('detail.unsupported'))

  // 同一卡片的连续输入合并为一步撤销
  const write = (patch) => store.dispatch([{ op: 'updateNode', id: n.id, patch }], { merge: 'detail:' + n.id })
  const locate = () => {
    const el = document.querySelector('.wb-canvas')
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = state.viewport.k
    store.setViewport({ k, x: r.width / 2 - (n.x + n.width / 2) * k, y: r.height / 2 - (n.y + n.height / 2) * k })
    store.select([n.id])
  }
  return h('div', { className: 'wb-detail' },
    h('div', { className: 'wb-detail-head' },
      h('input', {
        key: n.id + ':title', className: 'wb-detail-title', defaultValue: n.title || '', placeholder: t('node.titlePlaceholder'),
        onKeyDown: (e) => e.stopPropagation(),
        onBlur: (e) => { const v = e.currentTarget.value.trim(); if (v !== (n.title || '')) write({ title: v || null }) },
      }),
      h('button', { className: 'wb-btn', title: t('detail.locate'), onClick: locate }, t('detail.locate')),
      h('button', { className: 'wb-btn', onClick: () => { const p = togglePatch(n); if (p) store.dispatch([{ op: 'updateNode', id: n.id, patch: p }]) } }, n.collapsed ? t('fold.expand') : t('fold.collapse')),
      h('button', { className: 'wb-btn wb-btn-icon', title: t('detail.close'), 'aria-label': t('detail.close'), onClick: () => store.closeDetail() }, '×')),
    // key=卡片 id:切换卡片时重建编辑器,避免把上一张卡片的内容写到新卡片
    h(LiveMarkdownEditor, { key: n.id, value: n.text || '', placeholder: t('node.textPlaceholder'), onChange: (text) => write({ text }), t, boardId: state.board.id, transport }))
}
