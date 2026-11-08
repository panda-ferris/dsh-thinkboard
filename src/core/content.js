// 卡片内容相关的纯函数:HTML 沙箱文档、图片比例。无 DOM / Node 依赖,可单测。

// ---------------- HTML 卡片 ----------------
export const MAX_HTML_BYTES = 200 * 1024

/**
 * 把用户/agent 给的 HTML 片段封装成一个"受限文档",交给 sandbox iframe 的 srcdoc。
 * 安全模型(三层,任何一层单独都不足以放心):
 *   1. iframe 不带 allow-scripts / allow-same-origin → 脚本不执行,也读不到宿主页面
 *   2. 文档内 CSP: default-src 'none',只放行内联样式与 data:/blob: 图片 → 没有网络请求
 *   3. 去掉明显的执行入口(<script>、on* 属性、javascript: URL、<meta http-equiv=refresh>、<base>、<iframe>/<object>/<embed>)
 * 第 3 层是纵深防御与"所见即所得"的保证,不是安全边界本身。
 */
export function htmlDocument(html, { dark = false } = {}) {
  const body = sanitizeHtml(String(html ?? ''))
  const fg = dark ? '#e8e8ea' : '#1b1b1f'
  const bg = 'transparent'
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:">` +
    `<style>html,body{margin:0;background:${bg};color:${fg};font:13px/1.55 system-ui,-apple-system,sans-serif;overflow:auto}body{padding:8px 12px}img,video,svg{max-width:100%}a{color:inherit}</style>` +
    `</head><body>${body}</body></html>`
}

const BLOCK_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'meta', 'form', 'noscript', 'template']

export function sanitizeHtml(src) {
  let s = src
  // 整段删除危险元素(含内容);再清一遍残留的开标签
  for (const tag of BLOCK_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    s = s.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  // 事件处理属性:on*="…" / on*='…' / on*=bare
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // javascript: / vbscript: / data:text/html 的 URL(href/src/xlink:href/action/formaction/srcdoc)
  s = s.replace(/\s+(href|src|xlink:href|action|formaction|poster|background)\s*=\s*("|')?\s*(javascript|vbscript|data\s*:\s*text\/html)[^"'>\s]*("|')?/gi, '')
  s = s.replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // CSS 里的 expression()/javascript: 与外部 url()
  s = s.replace(/expression\s*\([^)]*\)/gi, '').replace(/url\s*\(\s*(['"]?)\s*(?!data:|blob:)[^)]*\)/gi, 'none')
  // @import
  s = s.replace(/@import[^;]*;?/gi, '')
  return s
}

export function checkHtmlSize(html) {
  const bytes = new TextEncoder().encode(String(html ?? '')).length
  if (bytes > MAX_HTML_BYTES) throw new Error(`html card exceeds ${MAX_HTML_BYTES} bytes`)
  return bytes
}

// ---------------- 图片 ----------------
/** 按原图比例,在给定宽度下求高度;非法输入返回 null。 */
export function heightForWidth(natural, width) {
  if (!natural || !(natural.w > 0) || !(natural.h > 0) || !(width > 0)) return null
  return Math.round((width * natural.h) / natural.w)
}

/**
 * "恢复原始比例":保持宽度,调整高度(图片带说明文字时,说明占的高度要加上)。
 * extra:卡片内图片之外占用的高度(标题栏、说明文字)。
 */
export function restoreRatioPatch(node, extra = 0) {
  const h = heightForWidth(node.natural, node.width)
  if (h === null) return null
  return { height: h + extra }
}

/** 新图片卡片的初始大小:宽度不超过 maxW,保持比例。 */
export function initialImageSize(natural, { maxW = 360, minW = 80 } = {}) {
  const nw = natural?.w > 0 ? natural.w : 320
  const nh = natural?.h > 0 ? natural.h : 200
  const w = Math.max(minW, Math.min(maxW, nw))
  return { width: Math.round(w), height: Math.round((w * nh) / nw) }
}

/** 图片文件类型白名单(与 Host 一致)。 */
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
export const isImageName = (name) => IMAGE_EXT.some((e) => String(name || '').toLowerCase().endsWith(e))

// ---------------- 内容类型转换 ----------------
/** 文字卡片 → HTML 卡片时保留标题;内容放进 html 字段。 */
export function toHtmlPatch(node) {
  return { type: 'html', html: typeof node.text === 'string' ? node.text : '', text: null }
}

// ---------------- 文字卡片:三种高度状态 ----------------
// 默认(缺省):高度 = 用户最近一次手动设置的高度。
// 折叠(fold:'collapsed'):固定高度 COLLAPSED_HEIGHT,只看开头。
// 展开(fold:'expanded'):高度 = 内容的实际高度(由客户端量出后传入)。
//
// 约定:`height` 永远是"所见高度"——折叠/展开是真的把高度改掉,并在 `baseHeight` 里记住默认高度。
// 这样连线、吸附、框的归属、小地图、导出全都按"所见"计算,无需到处特判;撤销与 agent 也天然可用。
// 手动拖拽卡片高度 = 重新设置"默认高度":任何状态下都退回默认状态(见 resizePatch),这样不会出现
// "拉高后又跳回旧的最高值"。
//
// 兼容旧数据:早期版本用 collapsed:true + expandedHeight(折叠时记住原高度),读取时视同 fold:'collapsed' + baseHeight。
export const COLLAPSED_HEIGHT = 112
export const MIN_CARD_HEIGHT = 40
export const MAX_CARD_HEIGHT = 20000

/** 规整出节点当前的折叠状态与默认高度(含旧字段兼容)。 */
export function foldState(node) {
  const fold = node?.fold === 'collapsed' || node?.fold === 'expanded' ? node.fold : node?.collapsed === true ? 'collapsed' : 'default'
  const raw = node?.baseHeight ?? node?.expandedHeight
  const base = Number.isFinite(raw) && raw > 0 ? raw : null
  return { fold, base }
}

const clampH = (h) => Math.round(Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, h)))
/** 清掉所有折叠相关字段(含旧字段),用于回到默认状态。 */
const CLEAR = { fold: null, baseHeight: null, collapsed: null, expandedHeight: null }

/** 当前状态下的"默认高度":默认状态取现高;折叠/展开状态取记住的值(丢失则兜底为现高与 240 的较大者)。 */
export function defaultHeightOf(node) {
  const { fold, base } = foldState(node)
  if (fold === 'default') return node.height
  return base ?? Math.max(node.height, 240)
}

/**
 * 切到折叠。已经是折叠返回 null(无需改动)。
 * 本来就矮于折叠高度的卡片:状态记为折叠,但高度不变(不会被撑高)。
 */
export function collapsePatch(node) {
  const { fold } = foldState(node)
  if (fold === 'collapsed') return null
  const base = defaultHeightOf(node)
  const p = { ...CLEAR, fold: 'collapsed', baseHeight: base }
  return base <= COLLAPSED_HEIGHT ? { ...p, height: base } : { ...p, height: COLLAPSED_HEIGHT }
}

/**
 * 切到展开:高度 = contentHeight(调用方量出的内容实际高度)。
 * contentHeight 不是有效数字时返回 null(不改动)——量不出来就不要乱改高度。
 * 已经是展开且高度已等于内容高度返回 null。
 */
export function expandPatch(node, contentHeight) {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return null
  const { fold } = foldState(node)
  const h = clampH(contentHeight)
  if (fold === 'expanded' && node.height === h) return null
  return { ...CLEAR, fold: 'expanded', baseHeight: defaultHeightOf(node), height: h }
}

/** 切回默认:高度恢复为记住的默认高度,清掉折叠字段。已经是默认返回 null。 */
export function restorePatch(node) {
  const { fold } = foldState(node)
  if (fold === 'default') return null
  return { ...CLEAR, height: defaultHeightOf(node) }
}

/** 按目标状态切换。target: 'collapsed' | 'expanded' | 'default'。expanded 需要 contentHeight。 */
export function setFoldPatch(node, target, contentHeight) {
  if (target === 'collapsed') return collapsePatch(node)
  if (target === 'expanded') return expandPatch(node, contentHeight)
  return restorePatch(node)
}

/**
 * 手动拖拽调整后的补丁:
 *   - 高度变了:新高度就是新的"默认高度",并退出折叠/展开(回到默认状态);
 *   - 高度没变(只改了宽度或位置):不碰折叠状态——折叠的卡片横向拉宽后仍是折叠;
 *     展开状态下宽度变了,内容会重排、高度需要重新贴合,由客户端在量出新内容高度后用 refitPatch 处理。
 * 在默认状态下(没有任何折叠字段)只写 x/y/width/height,不多带字段。
 */
export function resizePatch(node, rect) {
  const { fold } = foldState(node)
  const p = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: clampH(rect.height) }
  const legacy = node.collapsed !== undefined || node.expandedHeight !== undefined || node.baseHeight !== undefined
  if (fold === 'default' && !legacy) return p
  if (p.height === Math.round(node.height)) return p        // 高度没变:保持折叠/展开状态
  return { ...p, ...CLEAR }
}

/** 一键切换的"快捷按钮":折叠 ↔ 展开之间切;默认状态下点它 = 展开(内容放不下时)。保留给卡片底部的按钮。 */
export function quickTogglePatch(node, contentHeight) {
  const { fold } = foldState(node)
  return fold === 'default' ? expandPatch(node, contentHeight) : restorePatch(node)
}

/**
 * 展开状态下内容改了:是否需要把高度重新贴合内容。
 * 只有处于展开状态、且内容高度与现高有明显差别(>2px)时才需要;返回新的补丁或 null。
 */
export function refitPatch(node, contentHeight) {
  const { fold } = foldState(node)
  if (fold !== 'expanded') return null
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return null
  const h = clampH(contentHeight)
  return Math.abs(h - node.height) <= 2 ? null : { height: h }
}

/** 兼容旧调用:切换(折叠↔恢复)。保留给 agent/工具使用。 */
export const togglePatch = (node) => (foldState(node).fold === 'collapsed' ? restorePatch(node) : collapsePatch(node))
