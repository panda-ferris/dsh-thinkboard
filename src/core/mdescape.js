// 存盘前给"段落开头像 Markdown 结构的普通文字"打转义标记。
//
// 问题:段落文字恰好以 "# "、"- "、"1. "、"---" 等开头时(例如从 Word/网页粘来的手打编号 "1. 背景"),
// 原样存成 Markdown 后,下次读入会被解析成标题/列表/分割线,文档结构被悄悄改了。
// Tiptap 只转义行内符号(\ ` * _ [ ] ~),不处理行首的块级标记。
//
// 做法:序列化前遍历文档 JSON,在这类段落的第一个无格式文本节点里,于需要转义的字符之前插入哨兵字符;
// 序列化时(见 client/highlight.js 里的 escapeMarkdownSyntax 补丁)把哨兵换成反斜杠。
//   "# 标题"  → "\# 标题"      "- 项" → "\- 项"      "1. 背景" → "1\. 背景"      "---" → "\---"
// 纯函数,不依赖 DOM / 编辑器。

export const SENTINEL = '\uE000'

// 每个模式返回需要插入哨兵的位置(相对文本开头),不匹配返回 -1。
const RULES = [
  (t) => (/^#{1,6}(\s|$)/.test(t) ? 0 : -1),                           // 标题
  (t) => (/^[-+](\s|$)/.test(t) ? 0 : -1),                             // 无序列表(* 已被 Tiptap 转义)
  (t) => { const m = /^\d{1,9}([.)])(\s|$)/.exec(t); return m ? m[0].indexOf(m[1]) : -1 },   // 有序列表:转义 . 或 )
  (t) => (/^(-{3,}|={3,}|\+{3,})\s*$/.test(t) ? 0 : -1),                 // 分割线 / setext 标题下划线 / +++
]

/** 这段文字作为段落开头时需要在哪个位置插入哨兵;不需要返回 -1。 */
export function leadingEscapeIndex(text) {
  const t = String(text ?? '')
  for (const rule of RULES) { const i = rule(t); if (i >= 0) return i }
  return -1
}

const isPlainText = (n) => n && n.type === 'text' && typeof n.text === 'string' && !(n.marks && n.marks.length)

/** 返回处理后的文档 JSON(只复制被修改的路径,不改动入参)。 */
export function markLeadingMarkers(node) {
  if (!node || typeof node !== 'object') return node
  let content = node.content
  if (Array.isArray(content)) {
    let changed = false
    const next = content.map((c) => { const r = markLeadingMarkers(c); if (r !== c) changed = true; return r })
    if (changed) content = next
  }
  let out = content === node.content ? node : { ...node, content }
  if (out.type === 'paragraph' && Array.isArray(out.content) && isPlainText(out.content[0])) {
    const first = out.content[0]
    // 只在这段文字单独成"行首"时处理:整段(含后续节点)的第一个字符就是它的第一个字符
    const i = leadingEscapeIndex(first.text)
    if (i >= 0) {
      const text = first.text.slice(0, i) + SENTINEL + first.text.slice(i)
      out = { ...out, content: [{ ...first, text }, ...out.content.slice(1)] }
    }
  }
  return out
}

/** 序列化时把哨兵换成反斜杠(在 Tiptap 自己的转义之后调用)。 */
export const resolveSentinel = (text) => String(text).split(SENTINEL).join('\\')
