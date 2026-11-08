// 导出 PNG:把画布内容(world 层)克隆 → 内联计算样式 → SVG foreignObject → <img> → <canvas> → PNG。
// 与屏幕所见一致(同一套 DOM 与样式),无需另写一套绘制代码。限制:
//  - 图片卡片的 <img> 需要先转成 data URL(foreignObject 里不能再请求网络)。
//  - 输出像素上限 8192×8192,超出则自动降低缩放倍数。

const MAX_SIDE = 8192
const PAD = 40

/** 把 <img> 的内容读成 data URL(同源,已带登录 cookie)。 */
async function toDataUrl(src) {
  const res = await fetch(src)
  const blob = await res.blob()
  return await new Promise((ok, no) => {
    const r = new FileReader()
    r.onload = () => ok(r.result)
    r.onerror = () => no(r.error)
    r.readAsDataURL(blob)
  })
}

/** 计算内容外包盒(world 坐标)。 */
export function contentBounds(board, pad = PAD) {
  if (!board.nodes.length) return null
  const x1 = Math.min(...board.nodes.map((n) => n.x)) - pad
  const y1 = Math.min(...board.nodes.map((n) => n.y)) - pad
  const x2 = Math.max(...board.nodes.map((n) => n.x + n.width)) + pad
  const y2 = Math.max(...board.nodes.map((n) => n.y + n.height)) + pad
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function exportScale(w, h, want = 2) {
  return Math.max(0.1, Math.min(want, MAX_SIDE / w, MAX_SIDE / h))
}

/**
 * 去掉克隆里的交互装饰:选择高亮、手柄、连接点、对齐线、框选、组合外包盒(带 data-wb-ui)。
 * 单独导出是为了能直接对"导出用的克隆"做断言——页面上的原节点本来就有这些装饰,检查原节点证明不了导出干净。
 * 返回被移除的元素个数。
 */
export function stripInteractive(root) {
  let n = 0
  for (const el of root.querySelectorAll('.wb-handle,.wb-anchor,.wb-guides,.wb-marquee,.wb-unitbox,[data-wb-ui]')) { el.remove(); n++ }
  for (const el of root.querySelectorAll('.is-selected,.is-editing')) el.classList.remove('is-selected', 'is-editing')
  return n
}

/** 返回 PNG Blob。world 为 .wb-world 元素;background 为画布背景色(CSS 颜色)。 */
export async function renderPng(world, board, { background, scale = 2 } = {}) {
  const b = contentBounds(board)
  if (!b) throw new Error('empty board')
  const clone = world.cloneNode(true)
  const src = [world, ...world.querySelectorAll('*')]
  const dst = [clone, ...clone.querySelectorAll('*')]
  src.forEach((s, i) => {
    const cs = getComputedStyle(s)
    let css = ''
    for (const p of cs) css += `${p}:${cs.getPropertyValue(p)};`
    dst[i].setAttribute('style', css)
  })
  stripInteractive(clone)
  // 嵌套的 foreignObject(连线文字)在外层 foreignObject 里无法栅格化:改写成 SVG 原生的 rect + text。
  // 注意:样式要从"原节点"(仍在页面里)取,克隆节点已脱离文档,getComputedStyle 读不到值。
  const srcLabels = [...world.querySelectorAll('foreignObject')]
  const dstLabels = [...clone.querySelectorAll('foreignObject')]
  dstLabels.forEach((fo, i) => {
    const srcFo = srcLabels[i]
    const label = srcFo?.querySelector('.wb-edge-label')
    if (!label) return fo.remove()
    const x = Number(fo.getAttribute('x')) + Number(fo.getAttribute('width')) / 2
    const y = Number(fo.getAttribute('y')) + Number(fo.getAttribute('height')) / 2
    const text = label.textContent || ''
    const cs = getComputedStyle(label)
    const fs = parseFloat(cs.fontSize) || 12
    const w = Math.min(200, text.length * fs * 0.95 + 18)
    const NS = 'http://www.w3.org/2000/svg'
    const g = document.createElementNS(NS, 'g')
    const r = document.createElementNS(NS, 'rect')
    r.setAttribute('x', String(x - w / 2)); r.setAttribute('y', String(y - fs)); r.setAttribute('width', String(w)); r.setAttribute('height', String(fs * 2)); r.setAttribute('rx', '6')
    r.setAttribute('fill', cs.backgroundColor); r.setAttribute('stroke', cs.borderTopColor)
    const tx = document.createElementNS(NS, 'text')
    tx.setAttribute('x', String(x)); tx.setAttribute('y', String(y)); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central')
    tx.setAttribute('font-size', String(fs)); tx.setAttribute('fill', cs.color); tx.setAttribute('font-family', cs.fontFamily)
    tx.textContent = text
    g.append(r, tx)
    fo.replaceWith(g)
  })
  // 图片内联
  const imgs = [...clone.querySelectorAll('img')]
  await Promise.all(imgs.map(async (im) => {
    try { im.setAttribute('src', await toDataUrl(im.getAttribute('src'))) } catch { im.remove() }
  }))
  // 计算样式已逐个内联,var() 已被解析成具体颜色,无需再带变量
  clone.style.transform = `translate(${-b.x}px, ${-b.y}px)`
  clone.style.position = 'absolute'
  clone.style.left = '0'
  clone.style.top = '0'
  // XMLSerializer 对 HTML 元素已自带 xhtml 命名空间;重复声明会让 XML 非法,所以不再手动补
  const xml = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`
  const img = new Image()
  await new Promise((ok, no) => {
    img.onload = ok
    img.onerror = () => no(new Error('failed to rasterize'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
  const k = exportScale(b.w, b.h, scale)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(b.w * k)
  canvas.height = Math.round(b.h * k)
  const g = canvas.getContext('2d')
  g.scale(k, k)
  g.fillStyle = background || '#ffffff'
  g.fillRect(0, 0, b.w, b.h)
  g.drawImage(img, 0, 0)
  return await new Promise((ok, no) => canvas.toBlob((blob) => (blob ? ok(blob) : no(new Error('toBlob failed'))), 'image/png'))
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * 画布实际看到的底色:从元素起沿祖先找第一个不透明的背景色;
 * 全部透明(例如 dsh 在 macOS 上给外框设了半透明材质)时,回退到主题的基底色变量,最后才是白色。
 */
export function resolveBackground(el) {
  const opaque = (c) => {
    if (!c || c === 'transparent') return false
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return true
    const parts = m[1].split(/[ ,/]+/).filter(Boolean)
    return parts.length < 4 || parseFloat(parts[3]) >= 0.98
  }
  for (let n = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor
    if (opaque(c)) return c
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-9999px;background:var(--dsw-alias-bg-base,#ffffff)'
  document.body.appendChild(probe)
  const c = getComputedStyle(probe).backgroundColor
  probe.remove()
  return opaque(c) ? c : '#ffffff'
}
