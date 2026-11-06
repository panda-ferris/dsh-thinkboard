// slash 命令:在编辑器里输入 "/" 呼出菜单,插入块级元素(表格、图片、标题、列表、代码块……)。
// 本文件是纯逻辑:触发检测、候选定义与过滤。不依赖 DOM / 编辑器,可单测。

/** 所有命令。id 稳定(用于测试与记忆最近使用);keywords 用于模糊匹配,中英文都写。 */
export const COMMANDS = [
  { id: 'table', group: 'insert', icon: 'table', keywords: ['table', 'biaoge', '表格', '表'], needsInput: true },
  { id: 'image', group: 'insert', icon: 'image', keywords: ['image', 'img', 'picture', 'photo', 'tupian', '图片', '图', '照片'], needsInput: true },
  { id: 'h1', group: 'format', icon: 'h1', keywords: ['h1', 'heading', 'title', '标题', '一级标题', '大标题'] },
  { id: 'h2', group: 'format', icon: 'h2', keywords: ['h2', 'heading', '标题', '二级标题'] },
  { id: 'h3', group: 'format', icon: 'h3', keywords: ['h3', 'heading', '标题', '三级标题'] },
  { id: 'bullet', group: 'format', icon: 'bullet', keywords: ['bullet', 'list', 'ul', '无序', '列表', '项目符号'] },
  { id: 'ordered', group: 'format', icon: 'ordered', keywords: ['ordered', 'number', 'ol', '有序', '序号', '编号', '列表'] },
  { id: 'task', group: 'format', icon: 'task', keywords: ['task', 'todo', 'check', '待办', '任务', '清单', '勾选'] },
  { id: 'quote', group: 'format', icon: 'quote', keywords: ['quote', 'blockquote', '引用'] },
  { id: 'code', group: 'format', icon: 'code', keywords: ['code', 'codeblock', '代码', '代码块'] },
  { id: 'divider', group: 'format', icon: 'divider', keywords: ['divider', 'hr', 'line', 'rule', '分割线', '分隔线', '横线'] },
]

/**
 * 在光标前的文本里找 slash 触发。
 *   - "/" 必须在行首或空白之后(避免 "a/b"、"http://x" 里的斜杠误触发)。
 *   - 从 "/" 到光标之间不能含空白(含空白说明用户已经在写正常文字)。
 *   - 最长 20 个字符的查询,超出视为不是命令。
 * 返回 { from, query } 或 null。from 是 "/" 在 textBefore 里的下标。
 */
export function detectSlash(textBefore) {
  const i = textBefore.lastIndexOf('/')
  if (i < 0) return null
  if (i > 0 && !/\s/.test(textBefore[i - 1])) return null
  const query = textBefore.slice(i + 1)
  if (/\s/.test(query) || [...query].length > 20) return null
  return { from: i, query }
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '')

/**
 * 过滤并排序候选。
 *   - 空查询:按 COMMANDS 顺序全部列出(表格、图片在最前)。
 *   - 有查询:完全匹配 > 前缀匹配 > 包含匹配(仅 3 字符以上);同档位保持 COMMANDS 顺序。
 *   - label(t) 是界面语言下的显示名,也参与匹配,所以中文界面输入"表格"、英文界面输入 "table" 都能命中。
 */
export function filterCommands(query, label = (id) => id) {
  const q = norm(query)
  if (!q) return COMMANDS.slice()
  const scored = []
  COMMANDS.forEach((c, order) => {
    const names = [label(c.id), c.id, ...c.keywords].map(norm)
    let best = 99
    for (const n of names) {
      if (n === q) best = Math.min(best, 0)
      else if (n.startsWith(q)) best = Math.min(best, 1)
      else if (q.length >= 3 && n.includes(q)) best = Math.min(best, 2)   // 包含匹配只对较长的查询生效:单个字(如"表")不该命中所有含它的词
    }
    if (best < 99) scored.push({ c, best, order })
  })
  return scored.sort((a, b) => a.best - b.best || a.order - b.order).map((x) => x.c)
}

/** 菜单高亮项在上下键移动后的新下标(循环)。 */
export const moveIndex = (index, delta, length) => (length <= 0 ? 0 : (((index + delta) % length) + length) % length)

// ---------------- 表格尺寸选择 ----------------
export const TABLE_MAX_ROWS = 20
export const TABLE_MAX_COLS = 10
export const TABLE_DEFAULT = { rows: 3, cols: 3 }

/** 把用户选择的尺寸夹到合法范围(含表头行)。 */
export function clampTableSize(rows, cols) {
  const r = Number.isFinite(+rows) ? Math.round(+rows) : TABLE_DEFAULT.rows
  const c = Number.isFinite(+cols) ? Math.round(+cols) : TABLE_DEFAULT.cols
  return { rows: Math.min(TABLE_MAX_ROWS, Math.max(2, r)), cols: Math.min(TABLE_MAX_COLS, Math.max(1, c)) }
}

/** 尺寸文字 "4x3" / "4×3" / "4 3" / "4,3" → { rows, cols };不合法返回 null。行在前、列在后。 */
export function parseTableSize(text) {
  const m = String(text).trim().match(/^(\d{1,2})\s*(?:[x×*,，\s])\s*(\d{1,2})$/i)
  return m ? clampTableSize(+m[1], +m[2]) : null
}

// ---------------- 图片 ----------------
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
export const isImageFile = (f) => !!f && IMAGE_TYPES.includes(f.type)

/** 相对路径 assets/<name> 是否合法(与内核校验同一规则),用于渲染时判断是否需要映射成真实 URL。 */
export const ASSET_PATH = /^assets\/[A-Za-z0-9._-]+$/
export const isAssetPath = (s) => typeof s === 'string' && ASSET_PATH.test(s) && !s.includes('..')

/**
 * 渲染用:把 HTML 里 <img src="assets/xxx"> 的相对路径映射成白板的真实资源 URL。
 * 只替换合法的 assets/ 路径;其它 src(远程图片、data:、非法路径)原样保留。
 */
export function mapAssetUrls(html, urlFor) {
  return String(html).replace(/(<img\b[^>]*?\ssrc=)(["'])([^"']*)\2/gi, (m, pre, q, src) => (isAssetPath(src) ? `${pre}${q}${urlFor(src)}${q}` : m))
}
