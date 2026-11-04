import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHtml, htmlDocument, checkHtmlSize, MAX_HTML_BYTES, heightForWidth, restoreRatioPatch, initialImageSize, isImageName } from '../src/core/content.js'

// 常见 XSS 载荷:过滤后不应再含任何执行入口
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil/x.js></SCRIPT>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" ONERROR = "alert(1)">',
  "<svg onload='alert(1)'></svg>",
  '<body onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" JavaScript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="x.swf"></object>',
  '<embed src="x.swf">',
  '<form action="https://evil.example"><input name=a></form>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<style>@import url(https://evil.example/x.css);</style>',
  '<div style="background:url(https://evil.example/track.png)">x</div>',
  '<div style="width:expression(alert(1))">x</div>',
  '<img src="data:text/html,<script>alert(1)</script>">',
]
const DANGER = /<script|<iframe|<object|<embed|<form|<meta|<base|<link|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|srcdoc|expression\s*\(|@import|url\(\s*['"]?\s*https?:/i

test('sanitize: 常见 XSS 载荷过滤后不含任何执行入口', () => {
  for (const p of PAYLOADS) {
    const out = sanitizeHtml(p)
    assert.doesNotMatch(out, DANGER, `${p}  →  ${out}`)
  }
})

test('sanitize: 正常内容原样保留(标题、列表、表格、行内样式、data 图片)', () => {
  const ok = '<h2 style="color:red">标题</h2><ul><li>a</li><li><b>b</b></li></ul><table><tr><td>1</td></tr></table><img src="data:image/png;base64,AAAA" alt="x"><a href="https://example.com">链接</a>'
  assert.equal(sanitizeHtml(ok), ok)
})

test('sanitize: 不是字符串也不崩溃', () => {
  assert.equal(sanitizeHtml(''), '')
  assert.doesNotThrow(() => htmlDocument(undefined))
  assert.doesNotThrow(() => htmlDocument(null))
})

test('document: 带严格 CSP,且不含 script', () => {
  const doc = htmlDocument('<p>hi</p><script>alert(1)</script>')
  assert.match(doc, /Content-Security-Policy/)
  assert.match(doc, /default-src 'none'/)
  assert.doesNotMatch(doc.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), /<script/i)
  assert.match(doc, /<p>hi<\/p>/)
})

test('document: 暗色主题用浅色文字', () => {
  assert.match(htmlDocument('x', { dark: true }), /color:#e8e8ea/)
  assert.match(htmlDocument('x', { dark: false }), /color:#1b1b1f/)
})

test('size: 超限报错,边界值通过', () => {
  assert.equal(checkHtmlSize('a'.repeat(MAX_HTML_BYTES)), MAX_HTML_BYTES)
  assert.throws(() => checkHtmlSize('a'.repeat(MAX_HTML_BYTES + 1)), /exceeds/)
  assert.equal(checkHtmlSize('你'), 3) // 按字节计
})

test('image: 按宽度求高度、拒绝非法输入', () => {
  assert.equal(heightForWidth({ w: 400, h: 200 }, 300), 150)
  assert.equal(heightForWidth(null, 300), null)
  assert.equal(heightForWidth({ w: 0, h: 10 }, 300), null)
  assert.equal(heightForWidth({ w: 10, h: 10 }, 0), null)
})

test('image: 恢复原始比例保持宽度,并加上说明区占用的高度', () => {
  assert.deepEqual(restoreRatioPatch({ natural: { w: 400, h: 200 }, width: 200 }), { height: 100 })
  assert.deepEqual(restoreRatioPatch({ natural: { w: 400, h: 200 }, width: 200 }, 36), { height: 136 })
  assert.equal(restoreRatioPatch({ width: 200 }), null)
})

test('image: 初始大小不超过 maxW、不小于 minW、缺尺寸时有兜底', () => {
  assert.deepEqual(initialImageSize({ w: 1000, h: 500 }), { width: 360, height: 180 })
  assert.deepEqual(initialImageSize({ w: 100, h: 50 }), { width: 100, height: 50 })
  assert.equal(initialImageSize({ w: 20, h: 20 }).width, 80)
  assert.deepEqual(initialImageSize(null), { width: 320, height: 200 })
})

test('image: 扩展名判断不区分大小写', () => {
  assert.ok(isImageName('A.PNG') && isImageName('x.webp') && !isImageName('x.exe') && !isImageName(''))
})

import { COLLAPSED_HEIGHT, collapsePatch, expandPatch, togglePatch } from '../src/core/content.js'
import { createBoard } from '../src/core/model.js'
import { applyOps } from '../src/core/ops.js'

test('collapse: 折叠记住原高度并缩到固定高度;展开恢复', () => {
  const n = { id: 'a', type: 'text', height: 500 }
  assert.deepEqual(collapsePatch(n), { collapsed: true, expandedHeight: 500, height: COLLAPSED_HEIGHT })
  const folded = { ...n, collapsed: true, expandedHeight: 500, height: COLLAPSED_HEIGHT }
  assert.deepEqual(expandPatch(folded), { collapsed: null, expandedHeight: null, height: 500 })
  assert.equal(collapsePatch(folded), null)
  assert.equal(expandPatch(n), null)
})

test('collapse: 本来就很矮的卡片折叠后高度不变', () => {
  assert.deepEqual(collapsePatch({ height: 80 }), { collapsed: true, expandedHeight: 80 })
})

test('collapse: 丢失原高度时展开有兜底', () => {
  assert.equal(expandPatch({ collapsed: true, height: COLLAPSED_HEIGHT }).height, 240)
})

test('collapse: 经 applyOps 往返,字段被清理干净', () => {
  let b = applyOps(createBoard({ id: 'b' }), [{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, height: 400 } }]).board
  b = applyOps(b, [{ op: 'updateNode', id: 'a', patch: togglePatch(b.nodes[0]) }]).board
  assert.equal(b.nodes[0].height, COLLAPSED_HEIGHT)
  b = applyOps(b, [{ op: 'updateNode', id: 'a', patch: togglePatch(b.nodes[0]) }]).board
  assert.equal(b.nodes[0].height, 400)
  assert.ok(!('collapsed' in b.nodes[0]) && !('expandedHeight' in b.nodes[0]))
})
