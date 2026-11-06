// 高亮块(callout),语法同 Obsidian。纯逻辑:类型表、别名、首行解析与生成。不依赖编辑器 / DOM。
//
//   > [!type] 标题          type 不区分大小写;标题可省略
//   > [!type]- 标题         "-" 默认折叠,"+" 默认展开
//   > 正文……
//
// 未知类型:显示成 note 的样式,但保留作者写的原始类型名(往返时不改写)。

/** 规范类型 → { 别名, 颜色键, 图标键 }。顺序即菜单顺序。 */
export const CALLOUT_TYPES = [
  { id: 'note', aliases: [], color: 'blue', icon: 'pencil' },
  { id: 'abstract', aliases: ['summary', 'tldr'], color: 'teal', icon: 'clipboard' },
  { id: 'info', aliases: [], color: 'blue', icon: 'info' },
  { id: 'todo', aliases: [], color: 'blue', icon: 'check-circle' },
  { id: 'tip', aliases: ['hint', 'important'], color: 'teal', icon: 'flame' },
  { id: 'success', aliases: ['check', 'done'], color: 'green', icon: 'check' },
  { id: 'question', aliases: ['help', 'faq'], color: 'yellow', icon: 'help' },
  { id: 'warning', aliases: ['caution', 'attention'], color: 'orange', icon: 'alert' },
  { id: 'failure', aliases: ['fail', 'missing'], color: 'red', icon: 'x' },
  { id: 'danger', aliases: ['error'], color: 'red', icon: 'zap' },
  { id: 'bug', aliases: [], color: 'red', icon: 'bug' },
  { id: 'example', aliases: [], color: 'purple', icon: 'list' },
  { id: 'quote', aliases: ['cite'], color: 'gray', icon: 'quote' },
]

const BY_NAME = new Map()
for (const t of CALLOUT_TYPES) { BY_NAME.set(t.id, t); for (const a of t.aliases) BY_NAME.set(a, t) }

/** 任意类型名 → 样式用的规范类型(未知回退 note)。 */
export function canonicalType(name) {
  return BY_NAME.get(String(name ?? '').toLowerCase()) ?? BY_NAME.get('note')
}
export const isKnownType = (name) => BY_NAME.has(String(name ?? '').toLowerCase())

// 类型标识:字母、数字、连字符、下划线(Obsidian 允许自定义类型名如 custom-question-type)
const HEAD = /^\[!([A-Za-z0-9_-]+)\]([+-]?)(?:[ \t]+(.*))?$/

/**
 * 解析 blockquote 首段的第一行。
 * 返回 { type, fold, title } 或 null。type 保留原写法(大小写不变,用于往返);
 * fold: null | 'open'(+) | 'closed'(-);title 为空串表示未写标题。
 */
export function parseCalloutHead(line) {
  const m = HEAD.exec(String(line ?? '').replace(/\s+$/, ''))
  if (!m) return null
  return { type: m[1], fold: m[2] === '-' ? 'closed' : m[2] === '+' ? 'open' : null, title: (m[3] ?? '').trim() }
}

/** 生成首行(不含前导 "> ")。 */
export function formatCalloutHead({ type, fold, title }) {
  const sign = fold === 'closed' ? '-' : fold === 'open' ? '+' : ''
  return `[!${type}]${sign}${title ? ' ' + title : ''}`
}

/** 没写标题时显示的默认标题:类型名首字母大写(Obsidian 行为)。 */
export function defaultTitle(type) {
  const s = String(type ?? 'note')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** 一段文字(首段全文)里取出首行与其后的剩余部分。换行统一按 \n 处理。 */
export function splitFirstLine(text) {
  const s = String(text ?? '')
  const i = s.indexOf('\n')
  return i < 0 ? { first: s, rest: '' } : { first: s.slice(0, i), rest: s.slice(i + 1) }
}

/** 类型名是否合法(用于 slash 菜单、属性校验)。 */
export const VALID_TYPE = /^[A-Za-z0-9_-]{1,40}$/
export const isValidType = (t) => typeof t === 'string' && VALID_TYPE.test(t)
export const FOLD_VALUES = [null, 'open', 'closed']
