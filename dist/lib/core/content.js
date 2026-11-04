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

// ---------------- 文字卡片折叠 ----------------
// 折叠 = 真正把高度改小,并记住原高度(expandedHeight)。
// 这样连线、吸附、框的归属、小地图、导出全都按"所见"计算,无需到处特判;撤销与 agent 也天然可用。
export const COLLAPSED_HEIGHT = 112

export function collapsePatch(node) {
  if (node.collapsed) return null
  if (node.height <= COLLAPSED_HEIGHT) return { collapsed: true, expandedHeight: node.height }
  return { collapsed: true, expandedHeight: node.height, height: COLLAPSED_HEIGHT }
}

export function expandPatch(node) {
  if (!node.collapsed) return null
  const h = Number.isFinite(node.expandedHeight) && node.expandedHeight > 0 ? node.expandedHeight : Math.max(node.height, 240)
  return { collapsed: null, expandedHeight: null, height: h }
}

export const togglePatch = (node) => (node.collapsed ? expandPatch(node) : collapsePatch(node))
