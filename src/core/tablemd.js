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

import { isValidType, canonicalType, defaultTitle } from './callout.js'

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
  return hasNonStandardHeaders(table) || (table?.content ?? []).some((row) => (row.content ?? []).some((c) => isComplexCell(c) || !!cleanColwidth(c.attrs?.colwidth)))
}

/**
 * 表头是否偏离 GFM 的唯一形态:"第一行是表头、其余行全是普通单元格"。
 * GFM 只能表达这一种;有"表头列"(正文行里出现表头单元格)、第一行混有普通单元格、
 * 或没有表头行,存成 GFM 都会丢掉这些信息 → 必须存成 HTML。
 *   - 没有任何表头(全是普通单元格)也算:GFM 表格固定带表头行,存成 GFM 会凭空多出一行表头。
 */
export function hasNonStandardHeaders(table) {
  const rows = table?.content ?? []
  if (!rows.length) return false
  const isHead = (c) => c.type === 'tableHeader'
  const first = rows[0].content ?? []
  if (first.length && !first.every(isHead)) return true
  return rows.slice(1).some((r) => (r.content ?? []).some(isHead))
}

/** 是否有手动调整过的列宽(GFM 表格没有地方存宽度,有的话整张表要存成 HTML)。 */
export function hasCustomWidths(table) {
  return (table?.content ?? []).some((row) => (row.content ?? []).some((c) => !!cleanColwidth(c.attrs?.colwidth)))
}

export const COL_MIN = 40, COL_MAX = 1200
/** 列宽属性规整:数组里每项是 COL_MIN~COL_MAX 的整数像素;不合法(null、空、NaN、越界)整体视为没有。 */
export function cleanColwidth(v) {
  if (!Array.isArray(v) || v.length === 0) return null
  const out = []
  for (const x of v) {
    const n = Number(x)
    if (!Number.isFinite(n) || n <= 0) { out.push(0); continue }   // 0 = 该列没设置(合并单元格里部分列未设宽)
    out.push(Math.round(Math.min(COL_MAX, Math.max(COL_MIN, n))))
  }
  return out.some((n) => n > 0) ? out : null
}

// ---------- 行内:文本 + 标记 ----------
const MARK_TAG = { bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code', highlight: 'mark' }
// 标记的嵌套顺序固定,保证相同内容总是序列化成同一个字符串(稳定、可测)
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight', 'code']

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
    case 'blockquote': {
      const a = node.attrs ?? {}
      const inner = (node.content ?? []).map(block).join('')
      // 高亮块(callout):输出与编辑器 renderHTML 同构的结构,读取时由 callout 的 parseHTML 还原类型/标题/折叠
      if (isValidType(a.calloutType)) {
        const canon = canonicalType(a.calloutType)
        const title = (a.calloutTitle || '').trim() || defaultTitle(a.calloutType)
        const fold = a.calloutFold ? ` data-fold="${escAttr(a.calloutFold)}"` : ''
        return `<div class="wb-callout" data-callout="${escAttr(a.calloutType)}" data-callout-kind="${canon.id}" data-callout-color="${canon.color}"${fold}>`
          + `<div class="wb-callout-title"><span class="wb-callout-icon" data-icon="${canon.icon}"></span><span class="wb-callout-title-text">${esc(title)}</span></div>`
          + `<div class="wb-callout-body">${inner}</div></div>`
      }
      return `<blockquote>${inner}</blockquote>`
    }
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
  const widths = cleanColwidth(c.attrs?.colwidth)
  const cw = widths ? ` colwidth="${widths.join(',')}"` : ''
  const blocks = c.content?.length ? c.content.map(block).join('') : '<p></p>'
  return `<${tag}${span}${cw}${align}>${blocks}</${tag}>`
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

/**
 * 拖拽列边界时的新列宽。
 *   startWidth —— 开始拖动时的列宽(world 单位,即 DOM 的 offsetWidth)
 *   dxScreen   —— 鼠标在屏幕上移动的像素
 *   scale      —— 屏幕像素 / world 单位(画布缩放比例;表格处在被缩放的画布里)
 * 库自带的算法直接把屏幕像素当列宽增量,画布缩放不是 100% 时手柄会落后或超前于鼠标;这里除以缩放比例。
 */
export function draggedColWidth(startWidth, dxScreen, scale, min = COL_MIN, max = COL_MAX) {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1
  const w = Number(startWidth) + Number(dxScreen) / k
  if (!Number.isFinite(w)) return Math.round(Math.min(max, Math.max(min, Number(startWidth) || min)))
  return Math.round(Math.min(max, Math.max(min, w)))
}
