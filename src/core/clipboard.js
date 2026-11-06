// 复制粘贴的纯逻辑(不依赖 DOM / 编辑器,可在 Node 里测试):
//   1. looksLikeMarkdown —— 一段纯文本是不是 Markdown 源码(决定粘贴时是否按 Markdown 解析)
//   2. 粘贴 HTML 前的字符串级预处理(KM 死链接、飞书背景色高亮)
//   3. 复制出去的 HTML:把我们自己的结构降级成外部软件都认识的写法(只用内联样式)

// ---------------- 1. 是不是 Markdown ----------------
// 只有出现"明确的 Markdown 结构"才解析,普通一句话/一段文字不动,避免误伤。
// 结构特征(行级):标题、列表、有序列表、任务、引用、围栏代码、表格分隔行、分割线;
// 行内特征只算辅助:单独出现 **粗体** 一类不足以判定(普通文字里也可能有星号),需要同时有至少一个行级特征,
// 或者有两种以上行内特征。
const BLOCK_PATTERNS = [
  /^#{1,6}\s+\S/,                        // 标题
  /^\s*[-*+]\s+\S/,                      // 无序列表
  /^\s*\d{1,3}[.)]\s+\S/,                // 有序列表
  /^\s*[-*+]\s+\[[ xX]\]\s+\S/,          // 任务列表
  /^\s*>\s?\S/,                          // 引用 / callout
  /^\s*(```|~~~)/,                       // 围栏代码
  // 表格分隔行:多列(a | b)可省略首尾竖线;单列必须至少带一个竖线(|---|),否则就是普通的分割线 ---
  /^\s*(?:\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?|:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?)\s*$/,
  /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,        // 分割线
]
const INLINE_PATTERNS = [
  /\*\*[^*\n]+\*\*/, /(^|[^*])\*[^*\s][^*\n]*\*(?!\*)/, /==[^=\s][^=\n]*==/, /~~[^~\n]+~~/, /`[^`\n]+`/,
  /\[[^\]\n]+\]\([^)\s]+\)/, /!\[[^\]\n]*\]\([^)\s]+\)/,
]

/** 是否应该按 Markdown 解析这段粘贴的纯文本。 */
export function looksLikeMarkdown(text) {
  if (typeof text !== 'string') return false
  const t = text.replace(/\r\n?/g, '\n').trim()
  if (!t || t.length > 200_000) return false
  const lines = t.split('\n')
  // 只有一行且没有行级结构:当作普通文字(单行里的 **粗体** 不值得改写用户的输入)
  const blockHits = lines.filter((l) => BLOCK_PATTERNS.some((re) => re.test(l))).length
  if (blockHits >= 1) {
    // 单行的 "- 开头"/"1. 开头" 很可能只是用户随手打的一句话;至少要有 2 个结构行,或有标题/围栏/表格/引用这类强特征
    const strong = lines.some((l) => /^#{1,6}\s+\S/.test(l) || /^\s*(```|~~~)/.test(l) || /^\s*>\s?\[!\w+\]/.test(l) || BLOCK_PATTERNS[6].test(l))
    if (strong || blockHits >= 2) return true
    return lines.length > 1 && INLINE_PATTERNS.some((re) => re.test(t))
  }
  const inlineKinds = INLINE_PATTERNS.filter((re) => re.test(t)).length
  return inlineKinds >= 2
}

// ---------------- 2. 粘贴 HTML 的字符串级预处理 ----------------
const ASSET_REF = /^assets\/[A-Za-z0-9._-]+$/

/**
 * KM 把图片导出成 `[图片: image.png](source_id:…)` 这种内部引用,链接是死的。
 * 对 HTML:<a href="source_id:...">[图片: x]</a> → 一段不可点击的占位文字。
 */
export function neutralizeDeadLinks(html) {
  return String(html).replace(/<a\b[^>]*\bhref=(["'])(?:source_id|file|blob|filesystem):[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, inner) => {
    const label = inner.replace(/<[^>]+>/g, '').replace(/^\s*\[?\s*|\s*\]?\s*$/g, '').trim() || '图片'
    return `<span>[${label}(来自外部文档,无法导入)]</span>`
  })
}

/** CSS 颜色 → 是否像"荧光笔"底色(黄/绿/粉/橙等明亮浅色);白色、透明、深色、灰色不算。 */
export function isHighlightColor(css) {
  const c = String(css ?? '').trim().toLowerCase()
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'none') return false
  const named = { yellow: 1, lime: 1, cyan: 1, aqua: 1, pink: 1, orange: 1, gold: 1, lightyellow: 1, lightgreen: 1, khaki: 1, palegoldenrod: 1 }
  if (c in named) return true
  let r, g, b
  let m = c.match(/^#([0-9a-f]{3})$/); if (m) { [r, g, b] = m[1].split('').map((x) => parseInt(x + x, 16)) }
  if (!m) { m = c.match(/^#([0-9a-f]{6})/); if (m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16) } }
  if (!m) { m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)/); if (m) { r = +m[1]; g = +m[2]; b = +m[3]; const a = m[4] == null ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); if (a < 0.2) return false } }
  if (r == null) return false
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 40) return false            // 灰/白/黑:不是荧光色
  return max >= 150                            // 足够亮
}

/**
 * 把"带明亮背景色的 span"改成 <mark>(飞书、Word、网页的高亮都是这种形态)。
 * 只处理 span;块级元素的背景色(整段底色)不转,避免把整段文字变成高亮。
 */
export function backgroundToMark(html) {
  return String(html).replace(/<span\b([^>]*)\bstyle=(["'])([^"']*)\2([^>]*)>([\s\S]*?)<\/span>/gi, (m, a, _q, style, b, inner) => {
    const bg = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(style)
    if (!bg || !isHighlightColor(bg[1])) return m
    return `<mark>${inner}</mark>`
  })
}

/** 粘贴 HTML 的预处理流水线(顺序固定)。 */
export function preprocessPastedHtml(html) {
  if (typeof html !== 'string' || !html) return ''
  return backgroundToMark(neutralizeDeadLinks(html))
}

// ---------------- 3. 复制出去的 HTML ----------------
const COLORS = { blue: '#3b82f6', teal: '#14b8a6', green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444', purple: '#a855f7', gray: '#8b8b93' }
const hex2rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 高亮块 → 带标题的引用块,颜色用内联样式(外部软件不认我们的 class,但普遍认 blockquote 与内联样式)。 */
export function calloutToExternalHtml({ color = 'blue', title = '', bodyHtml = '', type = '', fold = null }) {
  const c = COLORS[color] || COLORS.blue
  const head = title ? `<p data-wb-callout-title style="margin:0 0 4px;font-weight:600;color:${c}">${esc(title)}</p>` : ''
  // data-wb-callout 等标记只有本应用认识:粘回来时还原成高亮块(类型、折叠、标题);外部软件会忽略它们,只看内联样式
  const safeType = /^[A-Za-z0-9_-]{1,40}$/.test(type) ? type : ''
  const marks = safeType ? ` data-wb-callout="${safeType}"${fold === 'closed' || fold === 'open' ? ` data-wb-callout-fold="${fold}"` : ''}` : ''
  return `<blockquote${marks} style="margin:8px 0;padding:8px 12px;border-left:4px solid ${c};background:${hex2rgba(c, 0.1)}">${head}${bodyHtml}</blockquote>`
}

export const TABLE_STYLE = 'border-collapse:collapse'
export const CELL_STYLE = 'border:1px solid #d0d0d0;padding:4px 8px;vertical-align:top'
// <th> 本来就是加粗的;样式里不写 font-weight,否则粘回编辑器时整个表头会被识别成粗体(**a**)
export const HEAD_STYLE = `${CELL_STYLE};background:#f3f3f3`
export const MARK_STYLE = 'background-color:#fff176'

/** 图片复制策略:远程保留;本地 assets 小图内嵌;其余(过大/无法读取)降级成文字说明。 */
export const INLINE_IMAGE_MAX = 300 * 1024
export function imageDecision(src, { size = null } = {}) {
  const s = String(src ?? '')
  if (/^https?:\/\//i.test(s)) return 'keep'
  if (/^data:image\//i.test(s)) return s.length <= INLINE_IMAGE_MAX * 1.4 ? 'keep' : 'text'
  if (ASSET_REF.test(s) || s.includes('/asset?')) return size != null && size <= INLINE_IMAGE_MAX ? 'inline' : (size == null ? 'inline' : 'text')
  return 'text'
}
