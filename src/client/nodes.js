// 节点视图:text / image / group / 未知类型。

import React from 'react'
import { MarkdownView, MarkdownEditor } from './markdown.js'
import { COLORS } from './colors.js'
import { SIDES, anchorPoint } from '../core/edges.js'
import { htmlDocument, checkHtmlSize, togglePatch } from '../core/content.js'
import { ShapeBody } from './shape.js'

const h = React.createElement

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** 图形的连接点不一定在外包盒边中点(三角形、星形等):按图形的实际连接点定位。 */
function anchorStyle(n, side) {
  if (n.type !== 'shape' || n.kind === 'text') return undefined
  const p = anchorPoint({ ...n, x: 0, y: 0 }, side)
  return { left: p.x, top: p.y }
}

export const NodeView = React.memo(function NodeView(props) {
  const { node: n, selected, multi, editing, store, transport, boardId, t, hover, onHover, onDown, onResizeDown, onAnchorDown, dropTarget, linkTarget, linkSide } = props
  const color = n.color && COLORS[n.color]
  const cls = ['wb-node', `wb-${n.type}`, n.type === 'shape' && `wb-shape-${n.kind}`, selected && 'is-selected', editing && 'is-editing', dropTarget && 'is-drop', props.leaving && 'is-leaving', linkTarget && 'is-link-target'].filter(Boolean).join(' ')
  const style = {
    left: n.x, top: n.y, width: n.width, height: n.height,
    ...(color ? { '--wb-node-fill': color.fill, '--wb-node-stroke': color.stroke } : null),
  }
  const showAnchors = hover || selected || linkTarget

  return h('div', {
    className: cls, style, 'data-wb-node': n.id,
    onPointerDown: (e) => onDown(e, n),
    onPointerEnter: () => onHover(n.id), onPointerLeave: () => onHover(null),
  },
    h(Body, { n, editing, store, transport, boardId, t, inDetail: props.detailId === n.id, count: props.memberCount }),
    n.type === 'group' && dropTarget ? h('div', { className: 'wb-drop-hint', 'data-wb-ui': true }, props.t('node.dropHint', { count: props.dropCount || 1 })) : null,
    n.type === 'group' && props.leaving ? h('div', { className: 'wb-drop-hint is-leave', 'data-wb-ui': true }, props.t('node.leaveHint')) : null,
    selected && !editing && !multi ? HANDLES.map((hd) => h('div', {
      key: hd, 'data-wb-handle': hd, className: `wb-handle wb-handle-${hd}`,
      onPointerDown: (e) => onResizeDown(e, n, hd),
    })) : null,
    n.type === 'shape' && n.kind !== 'text' && selected && !multi && !editing && props.onQuickAdd ? SIDES.map((s) => h('button', {
      key: 'q' + s, 'data-wb-quick': s, className: `wb-quick wb-quick-${s}`, title: props.t('shape.quickAdd'), 'aria-label': props.t('shape.quickAdd'),
      onPointerDown: (e) => { e.stopPropagation(); e.preventDefault() },
      onClick: (e) => { e.stopPropagation(); props.onQuickAdd(n, s) },
    }, '+')) : null,
    showAnchors && !editing ? SIDES.map((s) => h('div', {
      key: s, 'data-wb-anchor': s, className: `wb-anchor wb-anchor-${s}` + (linkSide === s ? ' is-active' : ''),
      style: anchorStyle(n, s),
      onPointerDown: (e) => onAnchorDown(e, n, s),
    })) : null,
  )
})

function Body({ n, editing, store, transport, boardId, t, inDetail, count }) {
  if (n.type === 'text') return h(TextBody, { n, editing, store, t, inDetail })
  if (n.type === 'image') return h(ImageBody, { n, editing, store, transport, boardId, t })
  if (n.type === 'html') return h(HtmlBody, { n, editing, store, t })
  if (n.type === 'group') return h(GroupBody, { n, editing, count, store, t })
  if (n.type === 'shape') return h(ShapeBody, { n, editing, store, t })
  return h('div', { className: 'wb-unknown' }, t('node.unknown', { type: n.type }))
}

/**
 * 标题栏。
 *  - 卡片编辑态(always=true):始终是一个输入框,回车把焦点交给正文,标题随卡片一起提交。
 *  - 框:双击标题就地编辑。
 *  - 其余:有标题就显示,双击可改。
 */
function TitleBar({ n, store, t, always, onEnter, inputRef, draftRef }) {
  const [edit, setEdit] = React.useState(false)
  const local = React.useRef(null)
  const ref = inputRef || local
  const key = n.type === 'group' ? 'label' : 'title'
  const value = n[key] || ''
  React.useEffect(() => { if (edit) { ref.current?.focus(); ref.current?.select() } }, [edit])
  const commit = (v) => {
    setEdit(false)
    const next = v.trim()
    if (next !== value) store.dispatch([{ op: 'updateNode', id: n.id, patch: { [key]: next || null } }])
  }
  if (always) {
    return h('input', {
      ref, className: 'wb-title-input', defaultValue: value, placeholder: t('node.titlePlaceholder'),
      'data-wb-title': true,
      onChange: (e) => { if (draftRef) draftRef.current = e.currentTarget.value },
      onPointerDown: (e) => e.stopPropagation(),
      onKeyDown: (e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter?.() }
      },
    })
  }
  if (edit) {
    return h('input', {
      ref, className: 'wb-title-input', defaultValue: value, placeholder: t('node.titlePlaceholder'),
      onPointerDown: (e) => e.stopPropagation(),
      onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value); if (e.key === 'Escape') setEdit(false) },
      onBlur: (e) => commit(e.currentTarget.value),
    })
  }
  if (!value && n.type !== 'group') return null
  return h('div', {
    className: 'wb-title' + (value ? '' : ' is-empty'),
    onPointerDown: (e) => { if (n.type === 'group') return; /* 卡片标题随卡片拖动 */ },
    onDoubleClick: (e) => { e.stopPropagation(); setEdit(true) },
  }, value || t('node.titlePlaceholder'))
}

function TextBody({ n, editing, store, t, inDetail }) {
  const titleRef = React.useRef(null)
  const enteredAt = React.useRef(0)
  const titleDraft = React.useRef(n.title || '')
  const bodyFocus = React.useRef(null)
  React.useEffect(() => { titleDraft.current = n.title || ''; if (editing) enteredAt.current = performance.now() }, [n.title, editing])
  // 进入编辑:新卡片(无内容)先聚焦标题;已有内容的卡片聚焦正文末尾
  const focusTitleFirst = editing && !n.text && !n.title
  React.useEffect(() => { if (focusTitleFirst) titleRef.current?.focus() }, [focusTitleFirst])

  const commit = React.useCallback((text, force) => {
    const title = (titleDraft.current ?? '').trim()
    // 刚进入编辑的 300ms 内出现的"离开"是浏览器在补发双击的 mouseup/click 导致的焦点抖动,不是用户意图:忽略
    if (!force && !text && !title && performance.now() - enteredAt.current < 300) { titleRef.current?.focus(); return false }
    store.setEditing(null)
    const patch = {}
    if (text !== (n.text || '')) patch.text = text
    if (title !== (n.title || '')) patch.title = title || null
    if (Object.keys(patch).length) store.dispatch([{ op: 'updateNode', id: n.id, patch }])
    else if (!n.text && !n.title) store.dispatch([{ op: 'removeNodes', ids: [n.id] }]) // 新建后什么都没输入:丢弃空卡片
    return true
  }, [n.id, n.text, n.title, store])

  const bodyRef = React.useRef(null)
  const overflow = useOverflow(bodyRef, [n.text, n.height, n.width, editing])
  const toggle = (e) => { e.stopPropagation(); const p = togglePatch(n); if (p) store.dispatch([{ op: 'updateNode', id: n.id, patch: p }]) }
  const openDetail = (e) => { e.stopPropagation(); store.openDetail?.(n.id) }
  const stop = (e) => e.stopPropagation()

  return h(React.Fragment, null,
    h(TitleBar, { n, store, t, always: editing, inputRef: titleRef, draftRef: titleDraft, onEnter: () => bodyFocus.current?.() }),
    editing
      ? h(MarkdownEditor, { initial: n.text || '', placeholder: t('node.textPlaceholder'), onCommit: commit, autofocus: !focusTitleFirst, focusRef: bodyFocus, titleRef })
      : h('div', { ref: bodyRef, className: 'wb-body' + (n.collapsed ? ' is-collapsed' : '') + (overflow ? ' is-overflow' : ''), 'data-wb-scroll': n.collapsed ? undefined : true },
        n.text ? h(MarkdownView, { text: n.text }) : n.title ? null : h('div', { className: 'wb-placeholder' }, t('node.textPlaceholder'))),
    // 折叠态 / 内容溢出:底部一条操作栏
    !editing && (n.collapsed || overflow) ? h('div', { className: 'wb-foldbar', 'data-wb-ui': true, onPointerDown: stop },
      h('button', { className: 'wb-foldbtn', onClick: toggle, title: n.collapsed ? t('fold.expand') : t('fold.collapse') }, n.collapsed ? t('fold.expand') : t('fold.collapse')),
      h('button', { className: 'wb-foldbtn', onClick: openDetail, title: t('detail.open') }, t('detail.open'))) : null,
    inDetail ? h('div', { className: 'wb-indetail', 'data-wb-ui': true }, t('detail.editingHere')) : null)
}

/** 内容是否高于容器(用于显示"展开全文"提示)。 */
function useOverflow(ref, deps) {
  const [over, setOver] = React.useState(false)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) { setOver(false); return }
    const check = () => setOver(el.scrollHeight > el.clientHeight + 4)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstChild) ro.observe(el.firstChild)
    return () => ro.disconnect()
  }, deps)
  return over
}

/** 图片卡片:图片 + 可选说明文字(双击图片下方的说明区编辑)。图片按卡片宽度等比显示。 */
function ImageBody({ n, editing, store, transport, boardId, t }) {
  const caption = typeof n.caption === 'string' ? n.caption : ''
  const [edit, setEdit] = React.useState(false)
  const [missing, setMissing] = React.useState(false)
  const inputRef = React.useRef(null)
  React.useEffect(() => { setMissing(false) }, [n.file])
  React.useEffect(() => { if (edit) { inputRef.current?.focus(); inputRef.current?.select() } }, [edit])
  // 选中后按回车编辑说明
  React.useEffect(() => { if (editing) setEdit(true) }, [editing])
  const commit = (v) => {
    setEdit(false)
    if (editing) store.setEditing(null)
    const next = v.trim()
    if (next !== caption) store.dispatch([{ op: 'updateNode', id: n.id, patch: { caption: next || null } }])
  }
  // 首次加载量到原始尺寸:写进 natural,用于"恢复原始比例"(只在缺失时写一次)
  const onLoad = (e) => {
    const im = e.currentTarget
    if (!n.natural && im.naturalWidth > 0) store.dispatch([{ op: 'updateNode', id: n.id, patch: { natural: { w: im.naturalWidth, h: im.naturalHeight } } }], { history: false })
  }
  return h(React.Fragment, null,
    h(TitleBar, { n, store, t }),
    h('div', { className: 'wb-image-wrap' },
      n.file && !missing
        ? h('img', { src: transport.assetUrl(boardId, n.file), draggable: false, alt: caption || n.title || '', onLoad, onError: () => setMissing(true) })
        : h('div', { className: 'wb-placeholder wb-image-missing' }, t('node.imageMissing'))),
    edit
      ? h('input', {
        ref: inputRef, className: 'wb-caption-input', defaultValue: caption, placeholder: t('node.captionPlaceholder'),
        onPointerDown: (e) => e.stopPropagation(),
        onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value); if (e.key === 'Escape') { setEdit(false); store.setEditing(null) } },
        onBlur: (e) => commit(e.currentTarget.value),
      })
      : caption
        ? h('div', { className: 'wb-caption', onDoubleClick: (e) => { e.stopPropagation(); setEdit(true) } }, caption)
        : null)
}

/** HTML 卡片:渲染在沙箱 iframe 里(无脚本、无网络、不透明 origin)。编辑时是源码输入框。 */
function HtmlBody({ n, editing, store, t }) {
  const [draft, setDraft] = React.useState(n.html || '')
  const [err, setErr] = React.useState('')
  const dark = useDark()
  React.useEffect(() => { if (editing) setDraft(n.html || '') }, [editing])
  const doc = React.useMemo(() => htmlDocument(n.html || '', { dark }), [n.html, dark])
  const commit = () => {
    try { checkHtmlSize(draft) } catch (e) { setErr(String(e.message)); return }
    store.setEditing(null)
    if (draft !== (n.html || '')) store.dispatch([{ op: 'updateNode', id: n.id, patch: { html: draft } }])
  }
  return h(React.Fragment, null,
    h(TitleBar, { n, store, t }),
    editing
      ? h('div', { className: 'wb-html-edit', onPointerDown: (e) => e.stopPropagation() },
        h('textarea', {
          className: 'wb-html-src', value: draft, spellCheck: false, autoFocus: true, placeholder: t('node.htmlPlaceholder'),
          onChange: (e) => { setDraft(e.target.value); setErr('') },
          onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); commit() } },
          onBlur: commit,
        }),
        err ? h('div', { className: 'wb-html-err', role: 'alert' }, err) : null)
      : n.html
        ? h('iframe', { className: 'wb-html-frame', sandbox: '', srcDoc: doc, title: n.title || 'html', tabIndex: -1 })
        : h('div', { className: 'wb-placeholder' }, t('node.htmlPlaceholder')))
}

/** 当前是否暗色主题(用 bg-base 的亮度判断,不依赖具体主题名)。 */
function useDark() {
  const [dark, setDark] = React.useState(() => isDark())
  React.useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] })
    return () => mo.disconnect()
  }, [])
  return dark
}
function isDark() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-9999px;background:var(--dsw-alias-bg-base,#fff)'
  document.body.appendChild(probe)
  const m = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255]
  probe.remove()
  return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000 < 128
}

function GroupBody({ n, editing, count, store, t }) {
  const ref = React.useRef(null)
  const done = React.useRef(false)
  React.useEffect(() => { if (editing) { done.current = false; ref.current?.focus(); ref.current?.select() } }, [editing])
  const commit = (v, cancel) => {
    if (done.current) return
    done.current = true
    store.setEditing(null)
    const next = v.trim()
    if (!cancel && next !== (n.label || '')) store.dispatch([{ op: 'updateNode', id: n.id, patch: { label: next || null } }])
  }
  return h('div', { className: 'wb-group-head' },
    editing
      ? h('input', {
        ref, className: 'wb-title-input wb-group-input', defaultValue: n.label || '', placeholder: t('node.groupPlaceholder'), 'aria-label': t('node.groupPlaceholder'),
        onPointerDown: (e) => e.stopPropagation(),
        onKeyDown: (e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value) }
          else if (e.key === 'Escape') { e.preventDefault(); commit(e.currentTarget.value, true) }
        },
        onBlur: (e) => commit(e.currentTarget.value),
      })
      : h('div', { className: 'wb-title' + (n.label ? '' : ' is-empty'), title: t('node.groupEditHint') }, n.label || t('node.groupPlaceholder')),
    count > 0 && !editing ? h('span', { className: 'wb-group-count', title: t('node.groupCount', { count }) }, String(count)) : null)
}
