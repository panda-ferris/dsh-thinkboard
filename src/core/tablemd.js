// 表格的 Markdown 序列化:简单表格存 GFM,单元格含块级内容(列表、多段、代码块…)时整张表存 HTML。
//
// 为什么
//   GFM 表格的单元格只能是一行文本。Tiptap 默认的做法是把单元格里的块压扁成 "a<br>- b<br>1. c",
//   存盘后列表结构就丢了(从 KM / 飞书粘贴来的、带缩进列表的表格因此在离开编辑后变形)。
//
// 规则
//   - 每个单元格只含一个段落(且段落里没有硬换行)→ "简单",整张表存标准 GFM。
//   - 任一单元格含 列表 / 任务列表 / 代码块 / 引用 / 多个块 / 硬换行 → "复杂",整张表存 <table> HTML。
//   - 读取:Markdown 里的 <table> 块会被编辑器的 HTML 解析规则读回,单元格里的列表原样恢复(已验证)。
//
// 纯函数,输入是 Tiptap 的 JSON 节点,不依赖 DOM / 编辑器。

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

/** 单元格是否"复杂"(无法安全地放进 GFM 的一行里)。 */
export function isComplexCell(cell) {
  const blocks = cell?.content ?? []
  if (blocks.length === 0) return false
  if (blocks.length > 1) return true
  const b = blocks[0]
  if (b.type !== 'paragraph') return true
  return (b.content ?? []).some((n) => n.type === 'hardBreak')
}

export function isComplexTable(table) {
  return (table?.content ?? []).some((row) => (row.content ?? []).some(isComplexCell))
}

// ---------- 行内:文本 + 标记 ----------
const MARK_TAG = { bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' }
// 标记的嵌套顺序固定,保证相同内容总是序列化成同一个字符串(稳定、可测)
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'code']

function inline(node) {
  if (node.type === 'hardBreak') return '<br>'
  if (node.type === 'image') return `<img src="${escAttr(node.attrs?.src ?? '')}"${node.attrs?.alt ? ` alt="${escAttr(node.attrs.alt)}"` : ''}>`
  if (node.type !== 'text') return ''
  let out = esc(node.text ?? '')
  const marks = [...(node.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
  for (const m of marks.reverse()) {
    if (m.type === 'link') out = `<a href="${escAttr(m.attrs?.href ?? '')}">${out}</a>`
    else if (MARK_TAG[m.type]) out = `<${MARK_TAG[m.type]}>${out}</${MARK_TAG[m.type]}>`
  }
  return out
}
const inlines = (nodes) => (nodes ?? []).map(inline).join('')

// ---------- 块 ----------
function block(node) {
  switch (node.type) {
    case 'paragraph': return `<p>${inlines(node.content)}</p>`
    case 'heading': { const l = Math.min(6, Math.max(1, node.attrs?.level ?? 1)); return `<h${l}>${inlines(node.content)}</h${l}>` }
    case 'bulletList': return `<ul>${(node.content ?? []).map(item).join('')}</ul>`
    case 'orderedList': {
      const start = node.attrs?.start && node.attrs.start !== 1 ? ` start="${Number(node.attrs.start)}"` : ''
      return `<ol${start}>${(node.content ?? []).map(item).join('')}</ol>`
    }
    case 'taskList': return `<ul data-type="taskList">${(node.content ?? []).map(taskItem).join('')}</ul>`
    case 'blockquote': return `<blockquote>${(node.content ?? []).map(block).join('')}</blockquote>`
    case 'codeBlock': return `<pre><code>${esc((node.content ?? []).map((n) => n.text ?? '').join(''))}</code></pre>`
    case 'horizontalRule': return '<hr>'
    default: return `<p>${inlines(node.content)}</p>`
  }
}
const item = (li) => `<li>${(li.content ?? []).map(block).join('')}</li>`
const taskItem = (li) => `<li data-type="taskItem" data-checked="${li.attrs?.checked ? 'true' : 'false'}">${(li.content ?? []).map(block).join('')}</li>`

function cell(c) {
  const tag = c.type === 'tableHeader' ? 'th' : 'td'
  const align = c.attrs?.align ? ` style="text-align:${escAttr(c.attrs.align)}"` : ''
  const span = (c.attrs?.colspan > 1 ? ` colspan="${c.attrs.colspan}"` : '') + (c.attrs?.rowspan > 1 ? ` rowspan="${c.attrs.rowspan}"` : '')
  const blocks = c.content?.length ? c.content.map(block).join('') : '<p></p>'
  return `<${tag}${span}${align}>${blocks}</${tag}>`
}

/** 整张表 → 单行 <table> HTML(不含换行,避免 Markdown 块被空行截断)。 */
export function tableToHtml(table) {
  const rows = (table.content ?? []).map((r) => `<tr>${(r.content ?? []).map(cell).join('')}</tr>`).join('')
  return `<table><tbody>${rows}</tbody></table>`
}

/** 复杂表格存 HTML,简单表格返回 null(由调用方走默认的 GFM 序列化)。块前后留空行,保证被识别为独立的 HTML 块。 */
export function complexTableMarkdown(table) {
  return isComplexTable(table) ? `\n${tableToHtml(table)}\n` : null
}
