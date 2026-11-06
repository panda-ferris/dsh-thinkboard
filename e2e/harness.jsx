// 浏览器测试页:内存版 Host(与真实 Host 共用 core/ops),渲染真实 Panel 之外的画布部分。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '../src/client/canvas.js'
import { Toolbar, Panel } from '../src/client/panel.js'
import { DetailPane } from '../src/client/detail.js'
import { renderPng, resolveBackground } from '../src/client/export.js'
import { createStore } from '../src/client/store.js'
import { configureAssetUrls } from '../src/client/boardimage.js'
import { createFocusBus } from '../src/client/focusbus.js'
import { chipsForSelection, parseRef } from '../src/client/chatref.js'
import { createBoard } from '../src/core/model.js'
import { applyOps, ensureIds } from '../src/core/ops.js'
import css from '../src/client/styles.css'

const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style)
let disk = createBoard({ id: 'b1', title: 'e2e' })
let rev = 1
const transport = {
  open: async () => ({ board: structuredClone(disk), rev }),
  apply: async (id, baseRev, ops) => { disk = applyOps(disk, ensureIds(ops)).board; rev++; return { rev } },
  assetUrl: (b, f) => f === 'assets/missing.png' ? 'data:image/png;base64,invalid' : (f === 'assets/wide.png' ? WIDE : TALL),
  uploadImage: async (b, file) => (file.name && file.name.includes('wide') ? 'assets/wide.png' : 'assets/x.png'),
}
// 两张真实 PNG(用 canvas 现场生成):400×200 与 100×300
const mkPng = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); return c.toDataURL('image/png') }
const TALL = mkPng(100, 300, '#d33')
const WIDE = mkPng(400, 200, '#33d')
const errors = []
configureAssetUrls((b, f) => transport.assetUrl(b, f))
const store = createStore({ transport, onError: (e) => errors.push(String(e.message || e)) })
const t = (k) => k
// 主题 token:测试时切换明/暗,最坏情况用一个很浅的 brand 色检验按钮对比度
window.__theme = (dark) => {
  const r = document.documentElement.style
  const v = dark
    ? { 'bg-base': '#161616', 'bg-layer-1': '#202020', 'bg-layer-2': '#2a2a2a', 'bg-overlay': '#262626', 'border-l1': '#333', 'border-l2': '#444', 'brand-primary': '#dbe4ff', 'label-primary': '#f2f2f2', 'label-secondary': '#a0a0a0', 'state-error-primary': '#ff6b6b' }
    : { 'bg-base': '#ffffff', 'bg-layer-1': '#f7f7f8', 'bg-layer-2': '#ececef', 'bg-overlay': '#fff', 'border-l1': '#e3e3e6', 'border-l2': '#cfcfd4', 'brand-primary': '#1f6feb', 'label-primary': '#111', 'label-secondary': '#666', 'state-error-primary': '#d33' }
  for (const [k, c] of Object.entries(v)) r.setProperty('--dsw-alias-' + k, c)
}
window.__theme(false)
function View() {
  const state = React.useSyncExternalStore(store.subscribe, store.getState)
  const [search, setSearch] = React.useState(false)
  const [tool, setTool] = React.useState(null)
  window.__setSearch = setSearch
  window.__setTool = setTool
  window.__tool = tool
  return <div className="wb-shell" style={{ position: 'fixed', inset: 0, paddingTop: 0 }}>
    <div className="wb-main">{state.board && <header className="wb-toolbar"><Toolbar store={store} state={state} transport={transport} t={t} onSearch={() => setSearch(true)} /></header>}<button id="prim" className="wb-btn wb-primary" style={{ position: 'absolute', zIndex: 99, left: 8, bottom: 8 }}>New chat</button><div className="wb-stage">{state.board && <Canvas store={store} state={state} transport={transport} t={t} search={search} setSearch={setSearch} detailId={state.detail} tool={tool} setTool={setTool} />}</div></div>
    {state.detail ? <aside className="wb-chat" style={{ width: 380 }}><div className="wb-side-body"><DetailPane store={store} state={state} t={t} transport={transport} /></div></aside> : null}
  </div>
}
// ---- 完整 Panel 模式(?panel=1):用于测试列表、顶栏标题、侧栏等外壳行为 ----
const boardsDb = new Map()
const mkBoard = (id, title, nodes = []) => { let b = createBoard({ id, title }); b = applyOps(b, nodes.map((node) => ({ op: 'addNode', node }))).board; boardsDb.set(id, { board: b, rev: 1 }); return b }
window.__panel = {
  mk: mkBoard,
  db: boardsDb,
  transport: {
    list: async () => [...boardsDb.values()].map(({ board }) => ({ id: board.id, title: board.title, nodes: board.nodes.length })),
    create: async (title) => { const id = 'nb' + boardsDb.size; return { board: mkBoard(id, title) } },
    open: async (id) => { const e = boardsDb.get(id); return { board: structuredClone(e.board), rev: e.rev } },
    rename: async (id, title) => { const e = boardsDb.get(id); e.board = applyOps(e.board, [{ op: 'setTitle', title }]).board; e.rev++ },
    duplicate: async (id) => { const e = boardsDb.get(id); const nid = 'nd' + boardsDb.size; return { board: mkBoard(nid, e.board.title + ' 副本', e.board.nodes) } },
    trash: async (id) => { boardsDb.delete(id) },
    apply: async (id, baseRev, ops) => { const e = boardsDb.get(id); e.board = applyOps(e.board, ensureIds(ops)).board; e.rev++; return { rev: e.rev } },
    assetUrl: () => TALL,
    uploadImage: async () => 'assets/x.png',
    subscribe: () => () => {},
    focus: async () => ({}),
  },
}
const params = new URLSearchParams(location.search)
window.__wb = { store, errors, renderPng, resolveBackground, get disk() { return disk }, reset(nodes, edges = []) { disk = createBoard({ id: 'b1', title: 'e2e' }); disk = applyOps(disk, [...nodes.map((node) => ({ op: 'addNode', node })), ...edges.map((edge) => ({ op: 'addEdge', edge }))]).board; rev++; return store.load('b1') } }
const clipboard = { text: '' }
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (x) => { clipboard.text = x }, readText: async () => clipboard.text }, configurable: true })
window.__clip = clipboard
if (params.get('panel')) {
  // 真实 Panel:没有 dsh 会话服务,对话区走"无会话"空态,不影响外壳行为
  const pRef = { current: () => {} }
  const pstore = createStore({ transport: window.__panel.transport, onError: (e) => { errors.push(String(e.message || e)); pRef.current(e) } })
  pstore.onErrorRef = pRef
  window.__pstore = pstore
  // ---- 假的 dsh 输入框服务:接口形状与 dsh 源码一致(sessions.scope → conversation.input.for → shell.addFiles) ----
  const fake = { calls: [], shellBusy: false, chips: [], forThrows: false, noShell: false, drafts: [], ids: [] }
  const shell = { get draftSnapshot() { return { text: '', references: fake.chips.map((c, i) => ({ source: c.source, ref: c.ref, offset: i, length: 1, label: c.label, clipboardText: c.clipboardText })) } }, addFiles: (refs, ids) => { fake.calls.push({ refs, ids }); if (fake.shellBusy) return false; fake.chips.push(...refs); return true } }
  const scoped = { get: (k) => (k === 'conversation' ? { input: { for: (c) => { if (fake.forThrows) throw new Error('boom'); if (c !== scoped) throw new Error('wrong scope'); return fake.noShell ? undefined : shell }, requestDraftInitialization: (b, o) => { fake.drafts.push(o); return 'applied' } } } : undefined) }
  window.__fake = fake
  window.__focusBus = createFocusBus()
  const ctxFake = { sessions: { scope: (sid) => (sid === 'S1' ? scoped : undefined), binding: (sid) => (sid === 'S1' ? { sessionId: 'S1' } : undefined), retain: () => ({ sessionId: 'S1', release() {} }) }, workspaces: {}, get: (k) => (k === 'conversation' ? scoped.get('conversation') : undefined) }
  window.__ctxFake = ctxFake
  window.__mountPanel = () => createRoot(document.getElementById('root')).render(<Panel store={pstore} transport={window.__panel.transport} t={t} useSessions={() => ({ ids: ['S1'], byId: { S1: { title: '会话一' } } })} renderSlot={() => <div id="fake-chat">chat</div>} SessionProvider={({ children }) => children} ctx={ctxFake} focusBus={window.__focusBus} />)
  document.title = 'READY'
} else {
createRoot(document.getElementById('root')).render(<View />)
store.load('b1').then(() => {
  store.dispatch([
    { op: 'addNode', node: { id: 'a', type: 'text', x: 100, y: 100, width: 200, height: 100, title: 'A', text: '**hello** `code`' } },
    { op: 'addNode', node: { id: 'b', type: 'text', x: 500, y: 130, width: 200, height: 100, title: 'B', text: '- x\n- y' } },
    { op: 'addNode', node: { id: 'g', type: 'group', x: 60, y: 400, width: 500, height: 260, label: '框', color: 'blue' } },
    { op: 'addNode', node: { id: 'c', type: 'text', x: 100, y: 460, width: 160, height: 90, text: 'in group' } },
    { op: 'addNode', node: { id: 'img', type: 'image', file: 'assets/x.png', x: 800, y: 100, width: 200, height: 100 } },
  ], { history: false })
  document.title = 'READY'
})
}
