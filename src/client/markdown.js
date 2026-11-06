// Markdown 编辑与渲染。
//   - 非编辑态:共享的无界面 Tiptap 编辑器把 markdown 转成 HTML(带缓存),所有卡片共用,开销很小。
//   - 编辑态:只有被编辑的那一张卡片挂载一个真正的 Tiptap 实例(所见即所得),存盘仍是 markdown 文本。
// 受限的语法子集(StarterKit + 表格/任务列表/图片),保证 markdown 往返稳定。

import React from 'react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { mergeAdjacentLists } from '../core/listmerge.js'
import { complexTableMarkdown } from '../core/tablemd.js'
import { detectSlash, isImageFile, TABLE_DEFAULT } from '../core/slash.js'
import { BoardImage, setCurrentBoard } from './boardimage.js'
import { SlashMenu } from './slashmenu.js'
import { runCommand, insertImages, pickImageFiles } from './slashcmds.js'

const h = React.createElement

/**
 * 列表键盘行为(编辑态):
 *  - Tab 缩进:把当前项连同它的整棵子树一起变成前一个同级项的子项 —— 子层的相对层级不变。
 *    (ProseMirror 的 sinkListItem 本身就是这个语义:被缩进的项带着它的子列表一起下沉。)
 *  - Shift+Tab 提升:当前项连同子树移到上一层,成为父项的下一个兄弟;后面的同级兄弟留在原处。
 *  - 顶层项 Shift+Tab 不拆散列表(什么都不做),避免把整个列表变成一堆段落。
 *  - 只在光标位于列表项内时接管 Tab,其余位置保持浏览器默认(不吞掉焦点切换)。
 */
const mergeKey = new PluginKey('wbMergeLists')

const MergeLists = Extension.create({
  name: 'wbMergeLists',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: mergeKey,
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged)) return null
        const tr = state.tr
        return mergeAdjacentLists(tr) ? tr : null
      },
    })]
  },
})

const ListKeys = Extension.create({
  name: 'wbListKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const inList = (editor) => editor.isActive('listItem') || editor.isActive('taskItem')
    const itemName = (editor) => (editor.isActive('taskItem') ? 'taskItem' : 'listItem')
    return {
      Tab: ({ editor }) => {
        if (!inList(editor)) return false
        editor.commands.sinkListItem(itemName(editor))
        return true // 即使无法缩进(第一项)也吞掉 Tab,避免焦点跳走
      },
      'Shift-Tab': ({ editor }) => {
        if (!inList(editor)) return false
        const name = itemName(editor)
        // 顶层项(祖先里只有一层列表)不提升,防止拆散列表
        const { $from } = editor.state.selection
        let lists = 0
        for (let d = $from.depth; d > 0; d--) if (['bulletList', 'orderedList', 'taskList'].includes($from.node(d).type.name)) lists++
        if (lists <= 1) return true
        liftKeepingSiblings(editor, name)
        return true
      },
    }
  },
})

/**
 * 提升一层,且"后面的同级兄弟留在原父项下"。
 * 做法:先把目标项后面的兄弟取出,用默认 liftListItem 提升目标,再把这些兄弟放回原父项的子列表。
 * 在一个事务里完成,所以撤销是一步。
 */
function liftKeepingSiblings(editor, name) {
  const { state } = editor
  const { $from } = state.selection
  // 找到目标 listItem 的深度
  let d = $from.depth
  while (d > 0 && $from.node(d).type.name !== name) d--
  if (d <= 0) return false
  const list = $from.node(d - 1)
  const idx = $from.index(d - 1)
  const after = idx < list.childCount - 1 // 后面有同级兄弟
  if (!after) return editor.commands.liftListItem(name)
  // 把"后面的兄弟"暂存为 slice:先删除它们,提升目标,再追加回目标原来的父项下
  const listStart = $from.start(d - 1)
  let pos = listStart
  for (let i = 0; i <= idx; i++) pos += list.child(i).nodeSize
  const siblings = []
  for (let i = idx + 1; i < list.childCount; i++) siblings.push(list.child(i))
  const parentItemDepth = d - 2 // 外层 listItem 的深度(包着这个子列表的那一项)
  if (parentItemDepth < 1 || $from.node(parentItemDepth).type.name !== name) return editor.commands.liftListItem(name)
  const listType = list.type
  return editor.chain().command(({ tr, dispatch }) => {
    // 1) 删除后面的兄弟(它们暂时离开,避免被 lift 当成子项接管)
    tr.delete(pos, pos + siblings.reduce((n, s) => n + s.nodeSize, 0))
    if (dispatch) dispatch(tr)
    return true
  }).liftListItem(name).command(({ tr, state: st, dispatch }) => {
    // 2) 提升后,目标项成为外层列表里 parentItem 的下一个兄弟;把原兄弟作为 parentItem 的子列表放回去
    // parentItem 现在位于:光标所在 listItem 的前一个兄弟
    const $c = st.selection.$from
    let dd = $c.depth
    while (dd > 0 && $c.node(dd).type.name !== name) dd--
    if (dd <= 0) return false
    const outer = $c.node(dd - 1)
    const i = $c.index(dd - 1)
    if (i < 1) return false
    const parentItem = outer.child(i - 1)
    // 找 parentItem 内的子列表(同类型),没有则新建
    let parentStart = $c.start(dd - 1)
    for (let k = 0; k < i - 1; k++) parentStart += outer.child(k).nodeSize
    const newList = listType.create(null, siblings)
    const insertAt = parentStart + parentItem.nodeSize - 1 // parentItem 内容末尾
    const last = parentItem.lastChild
    if (last && last.type === listType) {
      // 已有子列表:把兄弟追加进去
      const lastEnd = insertAt - 1
      tr.insert(lastEnd, siblings)
    } else {
      tr.insert(insertAt, newList)
    }
    if (dispatch) dispatch(tr)
    return true
  }).run()
}

/**
 * 表格:简单表格(单元格只有一行文字)存标准 GFM;任一单元格含列表/多段/代码块等块级内容时,
 * 整张表存 <table> HTML,否则这些结构会在存盘时被压扁成 "a<br>- b<br>1. c"。
 * 读取不用额外处理:Markdown 里的 <table> 块会被编辑器的 HTML 规则读回,单元格里的列表原样恢复。
 */
const RichTable = Table.extend({
  renderMarkdown(node, helpers, ctx) {
    const html = complexTableMarkdown(node)
    if (html !== null) return html
    return this.parent?.(node, helpers, ctx) ?? ''
  },
})

/**
 * slash 触发:每次文档/选区变化后,看光标前的文字是否构成 "/xxx"。
 * 状态通过 storage.onChange 回调给 React;菜单打开时,上下/回车/Esc 先交给菜单处理。
 */
const SlashTrigger = Extension.create({
  name: 'wbSlash',
  addOptions() { return { onChange: () => {}, handleKey: () => false } },
  addProseMirrorPlugins() {
    const opts = this.options
    const key = new PluginKey('wbSlash')
    return [new Plugin({
      key,
      state: {
        init: () => null,
        apply(tr, prev, _old, state) {
          if (!tr.docChanged && !tr.selectionSet) return prev
          const sel = state.selection
          if (!sel.empty) return null
          const $from = sel.$from
          // 只在普通文本块里触发(代码块里的 / 是代码;表格单元格里的段落可以)
          if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return null
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
          const hit = detectSlash(textBefore)
          return hit ? { from: $from.start() + hit.from, to: sel.from, query: hit.query } : null
        },
      },
      view: () => ({ update: (view) => { opts.onChange(key.getState(view.state), view) } }),
      props: {
        handleKeyDown: (view, e) => {
          if (!key.getState(view.state)) return false
          const handled = opts.handleKey(e)
          // 菜单消费了这个键:阻止浏览器的默认行为(否则 Enter 会换行、方向键会移动光标),
          // 并在事件上打标记——稍后到达编辑器自己的 keydown 监听器时,据此跳过 Esc 的"提交并退出编辑"
          if (handled) { e.preventDefault(); e.__wbSlashHandled = true }
          return handled
        },
      },
    })]
  },
})

const extensions = (slash) => [
  StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
  Markdown,
  RichTable, TableRow, TableHeader, TableCell,
  TaskList, TaskItem.configure({ nested: true }),
  BoardImage.configure({ inline: false, allowBase64: false }),
  ListKeys,
  MergeLists,
  ...(slash ? [SlashTrigger.configure(slash)] : []),
]

let headless
const cache = new Map()
const CACHE_MAX = 500

/** markdown → HTML(受 Tiptap schema 约束,不会产生脚本)。 */
export function renderMarkdown(md, boardId = null) {
  if (!md) return ''
  // 同样的 Markdown 在不同白板里图片 URL 不同,缓存键要带上白板 id
  const cacheKey = boardId ? `${boardId}\u0000${md}` : md
  setCurrentBoard(boardId)
  const hit = cache.get(cacheKey)
  if (hit !== undefined) return hit
  try {
    headless ??= new Editor({ extensions: extensions(), content: '', editable: false })
    headless.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
    const html = headless.getHTML()
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(cacheKey, html)
    return html
  } catch {
    return ''
  }
}

export function MarkdownView({ text, boardId, onToggleTask }) {
  setCurrentBoard(boardId ?? null)
  const html = renderMarkdown(text, boardId)
  return h('div', { className: 'wb-md', dangerouslySetInnerHTML: { __html: html } })
}

/** 编辑态。onCommit(text) 在失焦/Esc 时调用一次(内容未变也会调用,由上层比较)。 */
export function MarkdownEditor({ initial, placeholder, onCommit, autofocus = true, focusRef, titleRef, t = (k) => k, boardId, transport }) {
  const hostRef = React.useRef(null)
  const edRef = React.useRef(null)
  const done = React.useRef(false)
  const { slashOptions, menu, handlers } = useSlash({ t, boardId, transport, edRef })

  React.useEffect(() => {
    setCurrentBoard(boardId ?? null)
    const ed = new Editor({
      element: hostRef.current,
      extensions: extensions(slashOptions),
      content: initial || '',
      contentType: 'markdown',
      autofocus: autofocus ? 'end' : false,
      editorProps: { attributes: { class: 'wb-md wb-md-edit', 'data-placeholder': placeholder || '' }, ...handlers },
    })
    edRef.current = ed
    if (focusRef) focusRef.current = () => ed.commands.focus('start')
    const nodeEl = () => hostRef.current?.closest('[data-wb-node]')
    const finish = () => {
      if (done.current) return
      if (onCommit(ed.getMarkdown().trim()) === false) return // 调用方判定为误触:继续编辑
      done.current = true
    }
    // 焦点只在"这张卡片内部"(标题输入框 ↔ 正文)切换时不算离开;离开整张卡片才提交
    const onFocusOut = (e) => {
      const next = e.relatedTarget
      if (next && nodeEl()?.contains(next)) return
      setTimeout(() => { if (!nodeEl()?.contains(document.activeElement)) finish() }, 0)
    }
    const el = nodeEl()
    el?.addEventListener('focusout', onFocusOut)
    const onTitleKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish() } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish() } }
    titleRef?.current?.addEventListener('keydown', onTitleKey, true)
    ed.view.dom.addEventListener('keydown', (e) => {
      e.stopPropagation() // 编辑中的快捷键(删除、撤销等)不要被画布截获
      // 这次按键已被 slash 菜单消费(例如 Esc 用来关菜单):不要再当作"提交并退出编辑"
      if (e.__wbSlashHandled) return
      // 来自菜单里的输入框(表格尺寸):按键属于菜单,不是编辑器正文
      if (e.target?.closest?.('.wb-slash')) return
      if (e.key === 'Escape') { e.preventDefault(); finish() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish() }
    })
    return () => {
      el?.removeEventListener('focusout', onFocusOut)
      titleRef?.current?.removeEventListener('keydown', onTitleKey, true)
      // 卸载前兜底提交,防止切换焦点时丢内容
      if (!done.current) { done.current = true; onCommit(ed.getMarkdown().trim(), true) }
      ed.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return h(React.Fragment, null, h('div', { ref: hostRef, className: 'wb-md-host', 'data-wb-scroll': true, onPointerDown: (e) => e.stopPropagation() }), menu)
}

/**
 * slash 菜单 + 图片粘贴/拖入的共用逻辑。返回 { slashOptions, menu }:
 *   slashOptions 交给 extensions(),menu 是要渲染在编辑器旁边的菜单元素(或 null)。
 *   ctx = { t, boardId, transport, edRef }
 */
function useSlash({ t, boardId, transport, edRef }) {
  const [state, setState] = React.useState(null)   // { from, to, query, left, top }
  const keysRef = React.useRef(null)
  const stateRef = React.useRef(null)
  stateRef.current = state
  const close = React.useCallback(() => setState(null), [])

  const slashOptions = React.useMemo(() => ({
    onChange: (st, view) => {
      if (!st) { if (stateRef.current) setState(null); return }
      const c = view.coordsAtPos(st.to)
      setState({ ...st, left: c.left, top: c.bottom + 6 })
    },
    handleKey: (e) => (keysRef.current ? keysRef.current(e) : false),
  }), [])

  const upload = React.useCallback((f) => transport.uploadImage(boardId, f), [transport, boardId])
  const urlFor = React.useCallback((p) => transport.assetUrl(boardId, p), [transport, boardId])

  const onRun = React.useCallback(async (id, extra) => {
    const ed = edRef.current, st = stateRef.current
    if (!ed || !st) return
    setState(null)
    if (id === 'image') {
      // 先删掉 "/图片",记住位置;文件选择期间编辑器会失焦
      ed.chain().focus().deleteRange({ from: st.from, to: st.to }).run()
      const at = ed.state.selection.from
      const files = await pickImageFiles()
      if (files.length) await insertImages(ed, files, upload, urlFor, at)
      else ed.commands.focus()
      return
    }
    runCommand(ed, st, id, extra)
  }, [upload, urlFor])

  const menu = state ? h(SlashMenu, { query: state.query, anchor: { left: state.left, top: state.top }, t, onRun, onClose: close, keysRef, onRefocus: () => edRef.current?.commands.focus() }) : null
  // 粘贴/拖入图片文件:直接上传并插入(不依赖 slash)
  const handlers = React.useMemo(() => ({
    handlePaste: (_view, e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
      if (!files.length) return false
      e.preventDefault(); insertImages(edRef.current, files, upload, urlFor); return true
    },
    handleDrop: (_view, e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImageFile)
      if (!files.length) return false
      e.preventDefault(); insertImages(edRef.current, files, upload, urlFor); return true
    },
  }), [upload, urlFor])
  return { slashOptions, menu, handlers, close }
}

/**
 * 详情面板用的"持续编辑器":没有提交动作,内容变化防抖后回调 onChange(text)。
 * value 被外部(agent、撤销)改变且用户当前没在输入时,同步进编辑器。
 */
export function LiveMarkdownEditor({ value, placeholder, onChange, delay = 400, t = (k) => k, boardId, transport }) {
  const hostRef = React.useRef(null)
  const edRef = React.useRef(null)
  const { slashOptions, menu, handlers } = useSlash({ t, boardId, transport, edRef })
  const timer = React.useRef(null)
  const lastSent = React.useRef(value || '')
  const cb = React.useRef(onChange)
  cb.current = onChange

  React.useEffect(() => {
    setCurrentBoard(boardId ?? null)
    const ed = new Editor({
      element: hostRef.current,
      extensions: extensions(slashOptions),
      content: value || '',
      contentType: 'markdown',
      autofocus: 'end',
      editorProps: { attributes: { class: 'wb-md wb-md-edit wb-md-detail', 'data-placeholder': placeholder || '' }, ...handlers },
    })
    edRef.current = ed
    const flush = () => {
      clearTimeout(timer.current)
      timer.current = null
      const md = ed.getMarkdown().trim()
      if (md !== lastSent.current) { lastSent.current = md; cb.current(md) }
    }
    ed.on('update', () => { clearTimeout(timer.current); timer.current = setTimeout(flush, delay) })
    ed.on('blur', flush)
    ed.view.dom.addEventListener('keydown', (e) => e.stopPropagation())
    edRef.current.flush = flush
    return () => { flush(); ed.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部改动:用户没有待提交的输入时才覆盖,避免打断输入
  React.useEffect(() => {
    const ed = edRef.current
    if (!ed || timer.current) return
    const v = value || ''
    if (v === lastSent.current) return
    lastSent.current = v
    ed.commands.setContent(v, { contentType: 'markdown', emitUpdate: false })
  }, [value])

  return h(React.Fragment, null, h('div', { ref: hostRef, className: 'wb-md-host wb-detail-editor', 'data-wb-scroll': true }), menu)
}
