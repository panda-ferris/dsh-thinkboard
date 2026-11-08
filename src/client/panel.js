// 面板外壳:左侧白板列表 | 中间画布 | 右侧对话(内置 conversation.content)。
// 每张白板绑定一个会话,绑定关系存在浏览器本地(不进同步文件)。

import React from 'react'
import { Canvas } from './canvas.js'
import { COLOR_NAMES, COLORS } from './colors.js'
import { fitGroupOps, wrapInGroupOps } from '../core/arrange.js'
import { uid } from '../core/model.js'
import { renderPng, download, resolveBackground } from './export.js'
import { Icon } from './icons.js'
import { initialImageSize } from '../core/content.js'
import { DetailPane } from './detail.js'
import { sideFor, withSide, withoutSide, restorableDetail } from '../core/sidestate.js'
import { migrateLegacyKeys } from './storage.js'
import { chipsForSelection, dedupeChips } from './chatref.js'
import { focusViewport } from '../core/view.js'

migrateLegacyKeys()

const h = React.createElement
const LS_BOUND = 'dsh.thinkboard.sessions.v1' // { [boardId]: sessionId }
const LS_LAST = 'dsh.thinkboard.last.v1'
const LS_CHAT = 'dsh.thinkboard.chat.v1' // { open, width }
const LS_VIEW = 'dsh.thinkboard.viewport.v1' // { [boardId]: {x,y,k} }
const LS_SIDE = 'dsh.thinkboard.side.v1' // { [boardId]: {open, tab, detail} }  右栏状态,每个白板各一份
const LS_LIST = 'dsh.thinkboard.list.v1' // { open }  左侧白板列表的展开状态

const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* 隐私模式等 */ } }

function useStore(store) {
  return React.useSyncExternalStore(store.subscribe, store.getState)
}

export function Panel(props) {
  const { store, transport, t, useSessions, renderSlot, SessionProvider, ctx, focusBus } = props
  const state = useStore(store)
  const [boards, setBoards] = React.useState([])
  const [err, setErr] = React.useState(null)
  const [listOpen, setListOpenRaw] = React.useState(() => readLS(LS_LIST, { open: true }).open !== false)
  const setListOpen = (v) => setListOpenRaw((prev) => { const next = typeof v === 'function' ? v(prev) : v; writeLS(LS_LIST, { open: next }); return next })
  const [chat, setChat] = React.useState(() => ({ tab: 'chat', ...readLS(LS_CHAT, { open: true, width: 400 }) }))
  const setSide = (patch) => setChat((c) => { const n = { ...c, ...patch }; writeLS(LS_CHAT, n); return n })
  // 打开详情 → 展开右侧并切到详情标签;关闭详情 → 回到对话
  React.useEffect(() => { if (state.detail) setSide({ open: true, tab: 'detail' }); else setChat((c) => (c.tab === 'detail' ? { ...c, tab: 'chat' } : c)) }, [state.detail])
  // 右栏状态按白板记忆:展开/收起、标签页、详情里正在看的卡片。宽度全局共用,不在此列。
  // 恢复由"白板加载完成"触发,期间 restoring 为 true,避免把"恢复"本身当成用户操作再存回去。
  const restoring = React.useRef(false)
  const sideBoardId = state.board?.id ?? null
  React.useEffect(() => {
    if (!sideBoardId || state.loading) return
    const rec = sideFor(readLS(LS_SIDE, {}), sideBoardId, readLS(LS_CHAT, { open: true }).open !== false)
    restoring.current = true
    setChat((c) => ({ ...c, open: rec.open, tab: 'chat' }))
    const want = restorableDetail(rec, store.getState().board?.nodes)
    if (want) store.openDetail(want); else store.closeDetail()
    // 恢复结果与记录不一致(例如记录里的详情卡片已被删除)时,把纠正后的结果写回,
    // 否则恢复期间禁止保存、之后状态又没有变化,存储里会一直留着指向已不存在卡片的旧记录。
    const settled = { open: rec.open, tab: want ? 'detail' : 'chat', detail: want }
    if (rec.tab !== settled.tab || rec.detail !== settled.detail) writeLS(LS_SIDE, withSide(readLS(LS_SIDE, {}), sideBoardId, settled))
    // 让上面的状态更新先落定,再放开保存;否则中间态("先回对话标签")会被存下来覆盖真实记录
    const t0 = setTimeout(() => { restoring.current = false }, 0)
    return () => clearTimeout(t0)
  }, [sideBoardId, state.loading])
  React.useEffect(() => {
    if (!sideBoardId || state.loading || restoring.current) return
    const tab = chat.tab === 'detail' && state.detail ? 'detail' : 'chat'
    const m = readLS(LS_SIDE, {})
    const cur = sideFor(m, sideBoardId, true)
    const next = { open: chat.open, tab, detail: tab === 'detail' ? state.detail : null }
    if (cur.open === next.open && cur.tab === next.tab && cur.detail === next.detail && Object.prototype.hasOwnProperty.call(m, sideBoardId)) return
    writeLS(LS_SIDE, withSide(m, sideBoardId, next))
  }, [sideBoardId, state.loading, chat.open, chat.tab, state.detail])
  // 点击输入框里的引用对象 → 聚焦到白板里对应的元素(必要时先切换白板)。
  // 请求可能先于面板/白板就绪,所以:订阅 + 白板加载完成后各检查一次。
  const [focusNote, setFocusNote] = React.useState(null)
  const [search, setSearch] = React.useState(false)
  const [tool, setTool] = React.useState(null)
  const applyFocus = React.useCallback(() => {
    const req = focusBus?.peek?.()
    if (!req) return
    const st = store.getState()
    if (st.loading) return
    if (!st.board || st.board.id !== req.boardId) {
      // 在列表里就切过去;等加载完成后会再次进入这里
      if (boardsRef.current.some((b) => b.id === req.boardId)) { open(req.boardId) } else { focusBus.take(); setFocusNote(t('chatref.focusMissing')) }
      return
    }
    focusBus.take()
    const n = st.board.nodes.find((x) => x.id === req.nodeId)
    if (!n) { setFocusNote(t('chatref.focusMissing')); return }
    const canvas = document.querySelector('.wb-canvas')
    const r = canvas?.getBoundingClientRect()
    if (r) store.setViewport(focusViewport({ x: n.x, y: n.y, w: n.width, h: n.height }, { w: r.width, h: r.height }))
    store.select([n.id])
    setSearch(false)
  }, [focusBus, store])
  const boardsRef = React.useRef([])
  const openRef = React.useRef(() => {})
  React.useEffect(() => { boardsRef.current = boards }, [boards])
  React.useEffect(() => (focusBus ? focusBus.subscribe(applyFocus) : undefined), [applyFocus, focusBus])
  React.useEffect(() => { applyFocus() }, [state.board?.id, state.loading, boards.length])
  React.useEffect(() => { if (!focusNote) return; const id = setTimeout(() => setFocusNote(null), 2500); return () => clearTimeout(id) }, [focusNote])
  const [menu, setMenu] = React.useState(null)
  const [renaming, setRenaming] = React.useState(null)
  const [query, setQuery] = React.useState('')
  store.onErrorRef.current = (e) => setErr(e)

  const current = state.board
  const refreshList = React.useCallback(async () => {
    try { setBoards(await transport.list()) } catch (e) { setErr(e) }
  }, [transport])

  // 首次进入:加载列表,恢复上次打开的白板;订阅 Host 推送
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      const list = await transport.list().catch((e) => { setErr(e); return [] })
      if (!alive) return
      setBoards(list)
      const last = readLS(LS_LAST, null)
      const target = list.find((b) => b.id === last) ?? list[0]
      if (target) { writeLS(LS_LAST, target.id); await store.load(target.id); const v = readLS(LS_VIEW, {})[target.id]; if (v) store.setViewport(v); else requestAnimationFrame(() => fit(store, store.getState())) }
    })()
    const off = transport.subscribe((ev) => {
      refreshList()
      store.externalChange(ev.id, ev.event === 'applied' ? ev.rev : undefined)
    })
    return () => { alive = false; off() }
  }, [])

  React.useEffect(() => { setSearch(false); setTool(null) }, [state.board?.id])
  const open = (id) => { writeLS(LS_LAST, id); store.load(id).then(() => { const v = readLS(LS_VIEW, {})[id]; if (v) store.setViewport(v); else requestAnimationFrame(() => fit(store, store.getState())) }) }
  openRef.current = open
  // 视口变化去抖后存本机
  React.useEffect(() => {
    if (!current) return
    const t0 = setTimeout(() => { const m = readLS(LS_VIEW, {}); m[current.id] = state.viewport; writeLS(LS_VIEW, m) }, 400)
    return () => clearTimeout(t0)
  }, [current?.id, state.viewport])
  const createBoard = async () => {
    try {
      const { board } = await transport.create(t('list.untitled'))
      await refreshList()
      open(board.id)
      setRenaming(board.id)
    } catch (e) { setErr(e) }
  }
  const act = async (fn) => { try { await fn() } catch (e) { setErr(e) } finally { await refreshList() } }

  const q = query.trim().toLowerCase()
  const shown = q ? boards.filter((b) => b.title.toLowerCase().includes(q)) : boards

  return h('div', { className: 'wb-shell' },
    listOpen ? h('aside', { className: 'wb-list' },
      h('div', { className: 'wb-list-head' },
        h('span', { className: 'wb-list-title' }, t('list.title')),
        h('button', { className: 'wb-btn wb-btn-icon', title: t('list.new'), onClick: createBoard }, '+')),
      h('input', { className: 'wb-search', placeholder: t('list.search'), value: query, onChange: (e) => setQuery(e.target.value) }),
      h('div', { className: 'wb-list-body' },
        shown.length === 0 ? h('div', { className: 'wb-list-empty' }, boards.length ? t('list.noMatch') : t('list.empty')) : null,
        shown.map((b) => h('div', {
          key: b.id, className: 'wb-list-item' + (current?.id === b.id ? ' is-active' : ''),
          onClick: () => open(b.id),
          onContextMenu: (e) => { e.preventDefault(); setMenu({ id: b.id, x: e.clientX, y: e.clientY }) },
        },
          renaming === b.id
            ? h('input', {
              className: 'wb-title-input', autoFocus: true, defaultValue: b.title,
              onClick: (e) => e.stopPropagation(),
              onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) },
              onBlur: (e) => { const v = e.currentTarget.value.trim(); setRenaming(null); if (v && v !== b.title) act(() => transport.rename(b.id, v).then(() => current?.id === b.id && store.reload())) },
            })
            : h('span', { className: 'wb-list-name' }, b.title),
          h('button', { className: 'wb-btn wb-btn-icon wb-list-more', onClick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ id: b.id, x: r.left, y: r.bottom }) } }, '⋯'))))
    ) : null,

    h('section', { className: 'wb-main' },
      h('header', { className: 'wb-toolbar' },
        h('button', { className: 'wb-btn wb-btn-icon', title: t('list.toggle'), onClick: () => setListOpen((v) => !v) }, '☰'),
        h(BoardTitle, { current, onRename: (title) => act(async () => { await transport.rename(current.id, title); setBoards((bs) => bs.map((b) => (b.id === current.id ? { ...b, title } : b))); await store.reload() }), t }),
        h('span', { className: 'wb-status' }, state.saving > 0 ? t('status.saving') : current ? t('status.saved') : ''),
        h('span', { className: 'wb-spacer' }),
        current ? h(Toolbar, { store, state, transport, t, onSearch: () => setSearch(true) }) : null,
        h('button', { className: 'wb-btn' + (chat.open ? ' is-on' : ''), onClick: () => setSide({ open: !chat.open }) }, t('side.toggle'))),
      h('div', { className: 'wb-stage' },
        current
          ? h(Canvas, { store, state, transport, t, search, setSearch, tool, setTool, detailId: chat.open && chat.tab === 'detail' ? state.detail : null })
          : h('div', { className: 'wb-blank' },
            state.loading ? t('status.loading') : boards.length ? t('canvas.pick') : h('div', null, h('div', null, t('list.empty')), h('button', { className: 'wb-btn wb-primary', onClick: createBoard }, t('list.new')))),
        focusNote ? h('div', { className: 'wb-toast', role: 'status' }, focusNote) : null,
        err ? h('div', { className: 'wb-error', role: 'alert' }, h('span', null, errText(err, t)), h('button', { className: 'wb-btn', onClick: () => setErr(null) }, '×')) : null)),

    chat.open ? h(SidePane, { ...props, boardId: current?.id, chat, setChat, setSide, state }) : null,

    menu ? h(ContextMenu, {
      menu, onClose: () => setMenu(null), t,
      items: [
        { label: t('menu.rename'), run: () => setRenaming(menu.id) },
        { label: t('menu.duplicate'), run: () => act(async () => { const r = await transport.duplicate(menu.id); open(r.board.id) }) },
        { label: t('menu.delete'), danger: true, run: () => { if (confirm(t('menu.deleteConfirm'))) act(async () => { await transport.trash(menu.id); writeLS(LS_SIDE, withoutSide(readLS(LS_SIDE, {}), menu.id)); if (current?.id === menu.id) { const rest = (await transport.list()); rest[0] ? open(rest[0].id) : location.reload() } }) } },
      ],
    }) : null,
  )
}

/** 顶栏标题:双击就地改名;回车/失焦提交,Esc 放弃;空标题不提交。 */
function BoardTitle({ current, onRename, t }) {
  const [edit, setEdit] = React.useState(false)
  const ref = React.useRef(null)
  const done = React.useRef(false)
  React.useEffect(() => { if (edit) { done.current = false; ref.current?.focus(); ref.current?.select() } }, [edit])
  React.useEffect(() => { setEdit(false) }, [current?.id])
  if (!current) return h('span', { className: 'wb-board-title' }, '')
  const commit = (v, cancel) => {
    if (done.current) return
    done.current = true
    setEdit(false)
    const next = v.trim()
    if (!cancel && next && next !== current.title) onRename(next)
  }
  if (edit) {
    return h('input', {
      ref, className: 'wb-title-input wb-board-title-input', defaultValue: current.title, 'aria-label': t('title.edit'), maxLength: 120,
      onKeyDown: (e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value) }
        else if (e.key === 'Escape') { e.preventDefault(); commit(e.currentTarget.value, true) }
      },
      onBlur: (e) => commit(e.currentTarget.value),
    })
  }
  return h('span', { className: 'wb-board-title is-editable', title: t('title.hint'), onDoubleClick: () => setEdit(true) }, current.title)
}

function errText(e, t) {
  if (e?.code === 'stale') return t('error.stale')
  return String(e?.message || e)
}

function ContextMenu({ menu, items, onClose, t }) {
  React.useEffect(() => {
    const off = () => onClose()
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [onClose])
  return h('div', { className: 'wb-menu', style: { left: menu.x, top: menu.y }, onPointerDown: (e) => e.stopPropagation() },
    items.map((it) => h('button', { key: it.label, className: 'wb-menu-item' + (it.danger ? ' is-danger' : ''), onClick: () => { onClose(); it.run() } }, it.label)))
}

/**
 * 顶栏(低频项):搜索、导出、缩放比例。
 * 添加元素与撤销/重做/适配视图在画布左侧的工具栏里(常用,离画布近)。
 */
export function Toolbar({ store, state, transport, t, onSearch }) {
  const { board, viewport } = state
  return h('div', { className: 'wb-tools' },
    h('button', { className: 'wb-btn wb-btn-icon', title: t('search.open') + ' (⌘F)', 'aria-label': t('search.open'), onClick: onSearch }, h(Icon, { name: 'search' })),
    h('button', { className: 'wb-btn', title: t('tool.export'), disabled: !board.nodes.length, onClick: async () => {
      try {
        const world = document.querySelector('.wb-world')
        const blob = await renderPng(world, board, { background: resolveBackground(document.querySelector('.wb-stage') || document.body) })
        download(blob, `${(board.title || 'board').replace(/[\\/:*?"<>|]+/g, '_')}.png`)
      } catch (e) { store.fail(e) }
    } }, t('tool.export')),
    h('span', { className: 'wb-zoom', title: t('tool.zoom') }, Math.round(viewport.k * 100) + '%'))
}

function fit(store, state) {
  const { board } = state
  const root = document.querySelector('.wb-canvas')
  if (!root || !board.nodes.length) { store.setViewport({ x: 0, y: 0, k: 1 }); return }
  const r = root.getBoundingClientRect()
  const x1 = Math.min(...board.nodes.map((n) => n.x)), y1 = Math.min(...board.nodes.map((n) => n.y))
  const x2 = Math.max(...board.nodes.map((n) => n.x + n.width)), y2 = Math.max(...board.nodes.map((n) => n.y + n.height))
  const pad = 60
  const k = Math.min(1.5, Math.max(0.1, Math.min((r.width - pad * 2) / (x2 - x1), (r.height - pad * 2) / (y2 - y1))))
  store.setViewport({ k, x: (r.width - (x2 - x1) * k) / 2 - x1 * k, y: (r.height - (y2 - y1) * k) / 2 - y1 * k })
}

// ---- 右侧:对话 / 详情 ----
function SidePane(props) {
  const { chat, setChat, setSide, state, store, t, transport } = props
  const dragging = React.useRef(null)
  const onResizeDown = (e) => { dragging.current = { x: e.clientX, w: chat.width }; e.currentTarget.setPointerCapture(e.pointerId) }
  const onResizeMove = (e) => { if (!dragging.current) return; setChat({ ...chat, width: Math.max(300, Math.min(900, dragging.current.w - (e.clientX - dragging.current.x))) }) }
  const onResizeUp = () => { dragging.current = null; writeLS(LS_CHAT, chat) }
  const tab = chat.tab === 'detail' && state.detail ? 'detail' : 'chat'
  return h('aside', { className: 'wb-chat', style: { width: chat.width } },
    h('div', { className: 'wb-chat-resize', onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp }),
    h('div', { className: 'wb-side-tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': tab === 'chat', className: 'wb-side-tab' + (tab === 'chat' ? ' is-on' : ''), onClick: () => setSide({ tab: 'chat' }) }, t('chat.toggle')),
      state.detail ? h('button', { role: 'tab', 'aria-selected': tab === 'detail', className: 'wb-side-tab' + (tab === 'detail' ? ' is-on' : ''), onClick: () => setSide({ tab: 'detail' }) }, t('detail.tab')) : null),
    // 对话始终挂载(切到详情时只是隐藏),避免会话重建与滚动位置丢失
    h('div', { className: 'wb-side-body', hidden: tab !== 'chat' }, h(ChatPane, props)),
    tab === 'detail' ? h('div', { className: 'wb-side-body' }, h(DetailPane, { store, state, t, transport })) : null)
}

function ChatPane({ boardId, chat, setChat, state, t, ctx, renderSlot, SessionProvider, useSessions }) {
  const [ref, setRef] = React.useState(null)
  const [msg, setMsg] = React.useState('')
  const [note, setNote] = React.useState(null)
  React.useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 2500); return () => clearTimeout(id) }, [note])
  const sessions = useSessions((s) => s)
  const bound = readLS(LS_BOUND, {})

  // 为当前白板取得会话引用:已绑定的优先;否则让用户新建/选择
  React.useEffect(() => {
    if (!boardId) { setRef(null); return }
    const sid = bound[boardId]
    if (!sid || !sessions.byId?.[sid]) { setRef(null); return }
    let r
    try { r = ctx.sessions.retain(sid, { source: 'sidebarChat' }) } catch { setRef(null); return }
    setRef(r)
    return () => { try { r.release() } catch { /* 已释放 */ } }
  }, [boardId, bound[boardId], !!sessions.byId?.[bound[boardId]]])

  const bind = (sid) => { const m = { ...readLS(LS_BOUND, {}), [boardId]: sid }; writeLS(LS_BOUND, m); setMsg(String(Math.random())) }
  const [creating, setCreating] = React.useState(false)
  const createSession = async () => {
    setCreating(true)
    try {
      // 复用当前工作区:取最近会话所在的工作区
      const ws = ctx.workspaces?.list?.getSnapshot?.().items?.[0]
      if (!ws) throw new Error(t('chat.noWorkspace'))
      const sid = await ctx.uiWorkspace.connectWorkspace(ws.workspaceId)
      bind(sid)
    } catch (e) { alert(String(e?.message || e)) } finally { setCreating(false) }
  }

  const sel = state.board ? state.board.nodes.filter((n) => state.selection.includes(n.id)) : []
  return h(React.Fragment, null,
    !boardId ? h('div', { className: 'wb-chat-empty' }, t('chat.pickBoard'))
      : ref && SessionProvider
        ? h(React.Fragment, null,
          sel.length ? h('div', { className: 'wb-chat-ctx' }, t('chat.selected', { count: sel.length }), h('button', { className: 'wb-btn', onClick: () => { const r = attachSelection(ctx, ref, state.board, sel.map((n) => n.id), t); setNote(r.status === 'blocked' ? t('chatref.blocked') : r.status === 'duplicate' ? t('chatref.duplicate') : r.status === 'chips' ? (r.skipped ? t('chatref.attachedSkipped', { count: r.added, skipped: r.skipped }) : t('chatref.attached', { count: r.added })) : null) } }, t('chat.attach')), note ? h('span', { className: 'wb-chat-note', role: 'status' }, note) : null) : null,
          h('div', { className: 'wb-chat-body' }, h(SessionProvider, { session: ref }, renderSlot('thinkboard.chat', {}))))
        : h('div', { className: 'wb-chat-empty' },
          h('div', null, t('chat.noSession')),
          h('button', { className: 'wb-btn wb-primary', disabled: creating, onClick: createSession }, t('chat.newSession')),
          h(SessionPicker, { sessions, onPick: bind, t })))
}

function SessionPicker({ sessions, onPick, t }) {
  const ids = (sessions.ids || []).slice(0, 8)
  if (!ids.length) return null
  return h('div', { className: 'wb-picker' },
    h('div', { className: 'wb-picker-title' }, t('chat.orPick')),
    ids.map((id) => h('button', { key: id, className: 'wb-picker-item', onClick: () => onPick(id) }, sessions.byId[id]?.title || id.slice(0, 8))))
}

/**
 * 把选中的元素以"对象"(可点击、可删除的 chip)加入对话输入框。
 *
 * 路径:sessions.scope(会话) → conversation.input.for(scope) → 输入框 shell.addFiles(chips, [])。
 *   - addFiles 在光标处批量插入 chip,不要求有附件(ids 传空数组)。
 *   - 输入框正在发送时返回 false,此时提示用户稍后再试(不降级,免得出现一半是文本一半是对象)。
 * 取不到输入框(接口变化、会话未就绪)时,降级为纯文本草稿,功能不丢。
 * 返回 { status: 'chips' | 'duplicate' | 'text' | 'blocked', added, skipped }。
 */
export function attachSelection(ctx, ref, board, ids, t) {
  const all = chipsForSelection(board, ids)
  if (!all.length) return { status: 'blocked', added: 0, skipped: 0 }
  try {
    // 与 dsh 自带的附件处理同款取法:会话作用域 ctx → conversation 服务 → 该会话的输入框
    const scoped = ctx.sessions.scope(ref.sessionId)
    const shell = scoped?.get?.('conversation')?.input?.for?.(scoped)
    if (shell && typeof shell.addFiles === 'function') {
      // 去重:输入框里已有的元素不再加入(按 白板id/元素id 判断,标题变了也算同一个)
      const { fresh, skipped } = dedupeChips(all, shell.draftSnapshot?.references)
      if (!fresh.length) return { status: 'duplicate', added: 0, skipped }
      return shell.addFiles(fresh, []) ? { status: 'chips', added: fresh.length, skipped } : { status: 'blocked', added: 0, skipped }
    }
  } catch { /* 落到文本降级 */ }
  const lines = all.map((c) => c.ref)
  const text = `${t('chat.contextHeader', { board: board.title, id: board.id })}\n${lines.join('\n')}\n`
  try {
    const binding = ctx.sessions.binding(ref.sessionId)
    ctx.get('conversation')?.input?.requestDraftInitialization?.(binding, { prompt: text, whenDraftExists: 'append' })
    return { status: 'text', added: all.length, skipped: 0 }
  } catch { navigator.clipboard?.writeText(text); return { status: 'text', added: all.length, skipped: 0 } }
}
