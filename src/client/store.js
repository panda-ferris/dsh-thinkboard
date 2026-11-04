// Client 侧白板状态:不依赖 React,可单测。
//
// 所有修改都走 dispatch(ops):
//   1. 本地乐观应用 applyOps(与 Host 同一份代码,结果必然一致)
//   2. 入撤销栈(记录逆操作)
//   3. 异步发给 Host 落盘;失败则回滚并报错;stale 则重新加载
//
// 撤销 = 逆操作也是一批 ops,同样走 dispatch,因此同样落盘、同样同步给 agent。
// 视口(平移/缩放)、选择等纯界面状态不进 board,不触发落盘。

import { applyOps, ensureIds } from '../core/ops.js'
import { findNode } from '../core/model.js'

export function createStore({ transport, onError = () => {} }) {
  let state = { board: null, rev: 0, loading: false, saving: 0, selection: [], edgeSelection: null, viewport: { x: 0, y: 0, k: 1 }, editing: null, detail: null, scope: [], canUndo: false, canRedo: false }
  const listeners = new Set()
  const undo = []
  const redo = []
  let queue = Promise.resolve()

  const set = (patch) => {
    state = { ...state, ...patch, canUndo: undo.length > 0, canRedo: redo.length > 0 }
    if (state.detail && state.board && !state.board.nodes.some((n) => n.id === state.detail)) state = { ...state, detail: null }
    if (state.scope.length && state.board && !state.board.nodes.some((n) => { const p = typeof n.cluster === 'string' ? n.cluster.split('/') : []; return state.scope.every((id, i) => p[i] === id) })) state = { ...state, scope: [] }
    for (const l of listeners) l()
  }
  const emitOnly = () => set({})

  async function load(id) {
    undo.length = 0
    redo.length = 0
    set({ loading: true, board: null, selection: [], edgeSelection: null, editing: null, detail: null, scope: [] })
    try {
      const { board, rev } = await transport.open(id)
      set({ board, rev, loading: false })
    } catch (e) {
      set({ loading: false })
      onError(e)
    }
  }

  async function reload() {
    if (!state.board) return
    const { board, rev } = await transport.open(state.board.id)
    // 保留仍存在的选择
    const ids = new Set(board.nodes.map((n) => n.id))
    set({ board, rev, selection: state.selection.filter((i) => ids.has(i)) })
  }

  /** 逆操作:对每个 op 在应用前的 board 上计算。 */
  function invert(before, ops) {
    const inv = []
    for (const op of ops) {
      switch (op.op) {
        case 'addNode': inv.unshift({ op: 'removeNodes', ids: [op.node.id] }); break
        case 'removeNodes': {
          const nodes = op.ids.map((id) => findNode(before, id)).filter(Boolean)
          const edges = before.edges.filter((e) => op.ids.includes(e.fromNode) || op.ids.includes(e.toNode))
          inv.unshift(...nodes.map((node) => ({ op: 'addNode', node })), ...edges.map((edge) => ({ op: 'addEdge', edge })))
          break
        }
        case 'updateNode': {
          const n = findNode(before, op.id)
          const patch = {}
          for (const k of Object.keys(op.patch)) patch[k] = n && k in n ? n[k] : null
          inv.unshift({ op: 'updateNode', id: op.id, patch })
          break
        }
        case 'moveNodes': inv.unshift({ op: 'moveNodes', ids: op.ids, dx: -op.dx, dy: -op.dy }); break
        case 'addEdge': inv.unshift({ op: 'removeEdges', ids: [op.edge.id] }); break
        case 'removeEdges': inv.unshift(...before.edges.filter((e) => op.ids.includes(e.id)).map((edge) => ({ op: 'addEdge', edge }))); break
        case 'updateEdge': {
          const e = before.edges.find((x) => x.id === op.id)
          const patch = {}
          for (const k of Object.keys(op.patch)) patch[k] = e && k in e ? e[k] : null
          inv.unshift({ op: 'updateEdge', id: op.id, patch })
          break
        }
        case 'setTitle': inv.unshift({ op: 'setTitle', title: before.title }); break
      }
    }
    return inv
  }

  /** 乐观应用并异步落盘。返回 results。 */
  function dispatch(ops, { history = true, merge } = {}) {
    if (!state.board) return null
    const withIds = ensureIds(ops)
    const before = state.board
    let applied
    try { applied = applyOps(before, withIds) } catch (e) { onError(e); return null }
    if (history) {
      const entry = { undo: invert(before, withIds), redo: withIds, merge }
      const top = undo[undo.length - 1]
      if (merge && top && top.merge === merge) top.redo = [...top.redo, ...withIds], top.undo = [...entry.undo, ...top.undo]
      else undo.push(entry)
      redo.length = 0
    }
    set({ board: applied.board, saving: state.saving + 1 })
    persist(before, withIds)
    return applied.results
  }

  function persist(before, ops) {
    queue = queue.then(async () => {
      try {
        const r = await transport.apply(state.board.id, state.rev, ops)
        set({ rev: r.rev, saving: state.saving - 1 })
      } catch (e) {
        set({ saving: state.saving - 1 })
        onError(e)
        // 无论是冲突还是失败,以磁盘为准重新加载
        undo.length = 0
        redo.length = 0
        try { await reload() } catch (e2) { onError(e2) }
      }
    })
  }

  function doUndo() {
    const e = undo.pop()
    if (!e) return
    const before = state.board
    let applied
    try { applied = applyOps(before, e.undo) } catch (err) { onError(err); return }
    redo.push(e)
    set({ board: applied.board, saving: state.saving + 1 })
    persist(before, e.undo)
  }
  function doRedo() {
    const e = redo.pop()
    if (!e) return
    const before = state.board
    let applied
    try { applied = applyOps(before, e.redo) } catch (err) { onError(err); return }
    undo.push(e)
    set({ board: applied.board, saving: state.saving + 1 })
    persist(before, e.redo)
  }

  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    load, reload, dispatch, fail: onError,
    undo: doUndo, redo: doRedo,
    /**
     * 选择变化。详情面板打开着时,单选另一张文字卡片 → 详情自动切换过去(不必再去那张卡片上点"详情")。
     * 选中非文字卡片、多选、取消选择、选中连线:保持当前详情不变,避免面板突然变空或跳动。
     */
    select: (ids, edgeId = null) => {
      const patch = { selection: ids, edgeSelection: edgeId }
      if (state.detail && !edgeId && ids.length === 1 && ids[0] !== state.detail) {
        const n = state.board?.nodes.find((x) => x.id === ids[0])
        if (n && n.type === 'text') patch.detail = n.id
      }
      set(patch)
    },
    setViewport: (viewport) => set({ viewport }),
    setEditing: (id) => set({ editing: id }),
    /** 在右侧详情面板打开某张卡片;同一卡片不能同时就地编辑。 */
    openDetail: (id) => set({ detail: id, editing: state.editing === id ? null : state.editing }),
    closeDetail: () => set({ detail: null }),
    /** 双击进入组合后的上下文路径;空数组 = 最外层。 */
    setScope: (scope) => set({ scope }),
    /** Host 通知有外部改动(agent 或别的设备)。 */
    externalChange: async (id, rev) => {
      if (!state.board || state.board.id !== id) return
      if (rev !== undefined && rev === state.rev) return // 自己的写入回声
      if (state.saving > 0) return // 本地有未落盘修改,稍后落盘失败/成功后自行对齐
      await reload()
    },
    _emit: emitOnly,
  }
}
