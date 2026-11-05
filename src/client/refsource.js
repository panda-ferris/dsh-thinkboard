// 输入框 `@` 来源:候选列表、选择后插入对象、点击聚焦、发送时序列化。
// 抽成工厂是为了不依赖 dsh 就能测试;apply() 只负责把它注册进 inputTriggers。
import { SOURCE, parseRef, serializeRef, labelOf, chipFor } from './chatref.js'

export const MAX_CANDIDATES = 30

export function createReferenceSource({ getBoard, openBoard, focusBus, t }) {
  return {
    trigger: '@',
    name: SOURCE,
    showGroupTitle: false,
    // @ 菜单:列出"当前打开的白板"里的元素,按标题/文字/id 模糊匹配
    async candidates(_session, { query, quoted, signal } = {}) {
      if (quoted === true) return []
      const board = getBoard()
      if (!board) return []
      const q = String(query || '').trim().toLowerCase()
      const rows = []
      for (const n of board.nodes) {
        const label = labelOf(n)
        const hay = `${label} ${n.title ?? ''} ${n.label ?? ''} ${typeof n.text === 'string' ? n.text.slice(0, 200) : ''} ${n.id}`.toLowerCase()
        if (q && !hay.includes(q)) continue
        rows.push({ name: label, description: board.title, icon: 'session', section: t('chatref.section'), value: JSON.stringify({ boardId: board.id, nodeId: n.id }) })
        if (rows.length >= MAX_CANDIDATES) break
      }
      return signal?.aborted ? [] : rows
    },
    onPick({ candidate }) {
      let v
      try { v = JSON.parse(candidate.value) } catch { return undefined }
      const board = getBoard()
      const node = board?.nodes.find((n) => n.id === v?.nodeId)
      if (!board || board.id !== v.boardId || !node) return undefined
      return { insert: chipFor(board.id, node) }
    },
    // 点击输入框里的引用对象:请求面板聚焦(必要时先切换白板)
    openReference(_session, { ref }) {
      const p = parseRef(ref)
      if (!p) return false
      focusBus.request(p.boardId, p.nodeId)
      return true
    },
    // 发送时:读取"当前"白板里该元素的内容,转成模型看得懂的文本(不是引用时的快照)
    codec: {
      clipboardText: (ref) => ref,
      async serialize(ref) {
        const p = parseRef(ref)
        if (!p) return ref
        let board = getBoard()
        if (!board || board.id !== p.boardId) {
          try { board = await openBoard(p.boardId) } catch { board = null }
        }
        return serializeRef(ref, board)
      },
    },
  }
}
