// 白板元素在对话输入框里的"引用对象":编码、解析、显示标签、发送时的文本。纯函数,无 DOM / dsh 依赖。
//
// 设计要点
//   - chip 的 `ref` 是发送时序列化的唯一依据(dsh 的 codec 只拿到 ref 字符串),所以 ref 要自带"哪块白板的哪个元素"。
//   - 发送时由 codec 去读"当前"白板里该元素的内容,而不是引用时的快照:引用后再改了卡片,模型看到的是最新内容。
//   - ref 形如  @[白板标题或元素标题](dsh-thinkboard:<boardId>/<nodeId>);与 dsh 自带的 @[label](dsh-session:…) 同构,
//     即使 chip 没能被识别,退化成文本时人和模型也读得懂。
//   - boardId/nodeId 严格校验字符集,防止在 ref 里夹带别的东西。

const ID = /^[A-Za-z0-9_-]{1,64}$/
export const SCHEME = 'dsh-thinkboard'
export const SOURCE = 'thinkboard'

const MAX_LABEL = 40       // chip 上显示的标签长度
const MAX_BODY = 600       // 发送给模型的正文摘要长度(每个元素)

const KIND_LABEL = { text: '卡片', image: '图片', html: 'HTML 卡片', group: '框', shape: '图形' }

/** 元素的人类可读标题:标题 > 框标题 > 图形文字 > 正文首行 > 图片说明 > 类型名。 */
export function labelOf(n) {
  const first = (s) => (typeof s === 'string' ? s.trim().split('\n').find((l) => l.trim()) ?? '' : '')
  const raw = n.title?.trim() || n.label?.trim() || (n.type === 'shape' ? first(n.text) : '') || first(n.text) || n.caption?.trim() || KIND_LABEL[n.type] || '元素'
  const clean = raw.replace(/\s+/g, ' ').replace(/^#+\s*/, '')
  return clean.length > MAX_LABEL ? clean.slice(0, MAX_LABEL - 1) + '…' : clean
}

/** 方括号里不能出现 ] 和 [,否则会破坏 markdown 链接形态。 */
const safeLabel = (s) => s.replace(/[\[\]()\n]/g, ' ').replace(/\s+/g, ' ').trim() || '元素'

export function encodeRef(boardId, nodeId, label) {
  if (!ID.test(boardId) || !ID.test(nodeId)) throw new Error('invalid board or node id')
  return `@[${safeLabel(label)}](${SCHEME}:${boardId}/${nodeId})`
}

/** 解析 ref;不合法返回 null(调用方据此把 chip 标为失效)。 */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null
  const m = ref.match(/^@\[([^\]]*)\]\(dsh-thinkboard:([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})\)$/)
  return m ? { label: m[1], boardId: m[2], nodeId: m[3] } : null
}

/** 生成 chip 的插入描述(交给 dsh 输入框)。外观借用"会话"图标(dsh 只允许 session / file / folder 三种)。 */
export function chipFor(boardId, node) {
  const label = labelOf(node)
  const ref = encodeRef(boardId, node.id, label)
  return { source: SOURCE, ref, label, appearance: 'session', clipboardText: ref }
}

/**
 * 发送给模型的文本:元素的类型、id 和内容摘要,让 agent 既知道指的是谁,也能直接用 thinkboard_edit 去改。
 * board 为空(白板已被删除、读不到)时,退化成只含 id 的说明。
 */
export function serializeRef(ref, board) {
  const p = parseRef(ref)
  if (!p) return ref
  const head = `白板元素 [${p.nodeId}]`
  if (!board || board.id !== p.boardId) return `${head}(白板 ${p.boardId};当前读不到该白板的内容)`
  const n = board.nodes.find((x) => x.id === p.nodeId)
  if (!n) return `${head}(白板「${board.title}」,id: ${p.boardId};该元素已不存在)`
  const bits = [`${KIND_LABEL[n.type] ?? n.type}${n.kind && n.type === 'shape' ? `/${n.kind}` : ''}`]
  const title = n.title?.trim() || n.label?.trim()
  if (title) bits.push(`标题「${title}」`)
  const body = typeof n.text === 'string' ? n.text.trim() : n.caption?.trim() || ''
  const text = body.length > MAX_BODY ? body.slice(0, MAX_BODY) + '…(已截断,完整内容请用 thinkboard_read 读取)' : body
  return `白板「${board.title}」(id: ${p.boardId})中的元素 [${n.id}] ${bits.join(' ')}${text ? `:\n${text}` : ''}`
}

/** 选中的元素 → 一批 chip(框和连线之外的元素都可引用;顺序保持选择顺序)。 */
export function chipsForSelection(board, ids) {
  const set = new Set(ids)
  return board.nodes.filter((n) => set.has(n.id)).map((n) => chipFor(board.id, n))
}
