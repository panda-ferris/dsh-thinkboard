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

import { COLLAPSED_HEIGHT, MAX_CARD_HEIGHT, foldState, defaultHeightOf, collapsePatch, expandPatch, restorePatch, setFoldPatch, resizePatch, quickTogglePatch, refitPatch, togglePatch } from '../src/core/content.js'
import { createBoard } from '../src/core/model.js'
import { applyOps, OpError } from '../src/core/ops.js'

const card = (extra = {}) => ({ id: 'a', type: 'text', x: 10, y: 20, width: 300, height: 500, ...extra })
const apply = (b, node, patch) => applyOps(b, [{ op: 'updateNode', id: node.id, patch }]).board
const start = (n) => applyOps(createBoard({ id: 'b' }), [{ op: 'addNode', node: n }]).board

test('foldState: 缺省是默认状态;识别新旧两种写法;非法值按默认', () => {
  assert.deepEqual(foldState(card()), { fold: 'default', base: null })
  assert.deepEqual(foldState(card({ fold: 'collapsed', baseHeight: 500 })), { fold: 'collapsed', base: 500 })
  assert.deepEqual(foldState(card({ fold: 'expanded', baseHeight: 300 })), { fold: 'expanded', base: 300 })
  assert.deepEqual(foldState(card({ collapsed: true, expandedHeight: 480 })), { fold: 'collapsed', base: 480 })   // 旧数据
  for (const bad of [{ fold: 'x' }, { fold: 5 }, { fold: null }, { collapsed: 'yes' }, { collapsed: false }]) assert.equal(foldState(card(bad)).fold, 'default', JSON.stringify(bad))
  for (const bad of [0, -3, NaN, 'a', null]) assert.equal(foldState(card({ baseHeight: bad })).base, null, String(bad))
  assert.deepEqual(foldState(null), { fold: 'default', base: null })
})

test('折叠:记住默认高度并缩到固定高度;已折叠返回 null', () => {
  const p = collapsePatch(card())
  assert.deepEqual(p, { fold: 'collapsed', baseHeight: 500, collapsed: null, expandedHeight: null, height: COLLAPSED_HEIGHT })
  assert.equal(collapsePatch(card({ fold: 'collapsed', baseHeight: 500, height: COLLAPSED_HEIGHT })), null)
})

test('折叠:本来就矮的卡片不会被撑高,高度不变', () => {
  const p = collapsePatch(card({ height: 80 }))
  assert.equal(p.height, 80); assert.equal(p.baseHeight, 80); assert.equal(p.fold, 'collapsed')
})

test('展开:高度 = 内容高度,并记住默认高度;量不出内容高度时不改动', () => {
  assert.deepEqual(expandPatch(card(), 820), { fold: 'expanded', baseHeight: 500, collapsed: null, expandedHeight: null, height: 820 })
  for (const bad of [undefined, null, NaN, 0, -5, '700']) assert.equal(expandPatch(card(), bad), null, String(bad))
})

test('展开:内容高度被夹在合法范围内', () => {
  assert.equal(expandPatch(card(), 10).height, 40); assert.equal(expandPatch(card(), 1e9).height, MAX_CARD_HEIGHT)
  assert.equal(expandPatch(card(), 600.4).height, 600)
})

test('展开:已经展开且高度已贴合,返回 null;内容变了则重新量', () => {
  const n = card({ fold: 'expanded', baseHeight: 500, height: 700 })
  assert.equal(expandPatch(n, 700), null); assert.equal(expandPatch(n, 900).height, 900)
  assert.equal(expandPatch(n, 900).baseHeight, 500)           // 默认高度不因重新贴合而改变
})

test('折叠 → 展开:默认高度保持不变(折叠时记下的值)', () => {
  const folded = card({ fold: 'collapsed', baseHeight: 500, height: COLLAPSED_HEIGHT })
  assert.equal(expandPatch(folded, 760).baseHeight, 500)
})

test('回到默认:高度恢复为记住的默认高度,清掉所有折叠字段;已是默认返回 null', () => {
  assert.deepEqual(restorePatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 })), { fold: null, baseHeight: null, collapsed: null, expandedHeight: null, height: 500 })
  assert.deepEqual(restorePatch(card({ fold: 'expanded', baseHeight: 320, height: 900 })).height, 320)
  assert.equal(restorePatch(card()), null)
})

test('丢失默认高度时有兜底(不会变成 0 或 NaN)', () => {
  assert.equal(restorePatch(card({ fold: 'collapsed', height: COLLAPSED_HEIGHT })).height, 240)
  assert.equal(defaultHeightOf(card({ fold: 'expanded', height: 900 })), 900)
})

test('手动拖拽高度 = 重设默认高度:在折叠/展开状态下退出该状态,高度就是拖到的值', () => {
  const rect = { x: 5.4, y: 6.6, width: 321.2, height: 410.7 }
  assert.deepEqual(resizePatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 }), rect), { x: 5, y: 7, width: 321, height: 411, fold: null, baseHeight: null, collapsed: null, expandedHeight: null })
  assert.deepEqual(resizePatch(card({ fold: 'expanded', baseHeight: 500, height: 900 }), rect).fold, null)
})

test('只改宽度/位置(高度不变)的拖拽:折叠、展开状态保持不变', () => {
  const folded = card({ fold: 'collapsed', baseHeight: 500, height: COLLAPSED_HEIGHT })
  assert.deepEqual(resizePatch(folded, { x: 0, y: 0, width: 420, height: COLLAPSED_HEIGHT }), { x: 0, y: 0, width: 420, height: COLLAPSED_HEIGHT })
  const expanded = card({ fold: 'expanded', baseHeight: 500, height: 900 })
  assert.equal('fold' in resizePatch(expanded, { x: 0, y: 0, width: 420, height: 900 }), false)
  assert.equal(resizePatch(expanded, { x: 0, y: 0, width: 420, height: 899.6 }).fold, undefined)   // 取整后高度没变
  assert.equal(resizePatch(expanded, { x: 0, y: 0, width: 420, height: 905 }).fold, null)            // 高度变了才退出
})

test('手动拖拽高度:默认状态只写位置与尺寸,不多带字段;旧字段会被清掉', () => {
  assert.deepEqual(resizePatch(card(), { x: 1, y: 2, width: 3, height: 400 }), { x: 1, y: 2, width: 3, height: 400 })
  assert.equal(resizePatch(card({ collapsed: true, expandedHeight: 500, height: 112 }), { x: 1, y: 2, width: 3, height: 400 }).collapsed, null)
})

test('手动拖拽高度被夹在合法范围内', () => {
  assert.equal(resizePatch(card(), { x: 0, y: 0, width: 10, height: 1 }).height, 40)
  assert.equal(resizePatch(card(), { x: 0, y: 0, width: 10, height: 1e9 }).height, MAX_CARD_HEIGHT)
})

test('"拉高后又跳回旧的最高值"的回归:折叠→拖拽拉高→再展开/折叠,以拖拽的值为默认', () => {
  let b = start(card({ height: 500 }))
  b = apply(b, b.nodes[0], collapsePatch(b.nodes[0]))                                   // 折叠,默认高度记为 500
  b = apply(b, b.nodes[0], resizePatch(b.nodes[0], { x: 10, y: 20, width: 300, height: 700 }))   // 拖拽拉到 700
  assert.equal(b.nodes[0].height, 700); assert.equal(foldState(b.nodes[0]).fold, 'default')
  b = apply(b, b.nodes[0], collapsePatch(b.nodes[0]))                                   // 再折叠
  assert.equal(b.nodes[0].baseHeight, 700, '默认高度应是最近一次手动设置的 700,而不是更早的 500')
  b = apply(b, b.nodes[0], restorePatch(b.nodes[0]))
  assert.equal(b.nodes[0].height, 700)
})

test('refitPatch: 只有展开状态才贴合;差别在 2px 内不动;不改默认高度', () => {
  assert.equal(refitPatch(card(), 900), null)
  assert.equal(refitPatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 }), 900), null)
  const n = card({ fold: 'expanded', baseHeight: 500, height: 700 })
  assert.deepEqual(refitPatch(n, 820), { height: 820 }); assert.equal(refitPatch(n, 701), null); assert.equal(refitPatch(n, 698), null)
  for (const bad of [NaN, 0, -1, undefined]) assert.equal(refitPatch(n, bad), null)
})

test('quickTogglePatch: 默认→展开;展开/折叠→回到默认', () => {
  assert.equal(quickTogglePatch(card(), 800).fold, 'expanded')
  assert.equal(quickTogglePatch(card({ fold: 'expanded', baseHeight: 500, height: 800 }), 800).height, 500)
  assert.equal(quickTogglePatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 }), 800).height, 500)
})

test('setFoldPatch: 按目标状态分发', () => {
  assert.equal(setFoldPatch(card(), 'collapsed').fold, 'collapsed'); assert.equal(setFoldPatch(card(), 'expanded', 800).fold, 'expanded')
  assert.equal(setFoldPatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 }), 'default').height, 500); assert.equal(setFoldPatch(card(), 'default'), null)
  assert.equal(setFoldPatch(card(), 'bogus'), null)
})

test('togglePatch(agent 用):折叠 ↔ 恢复', () => {
  assert.equal(togglePatch(card()).fold, 'collapsed')
  assert.equal(togglePatch(card({ fold: 'collapsed', baseHeight: 500, height: 112 })).height, 500)
})

test('旧数据兼容:旧的 collapsed/expandedHeight 卡片可以被展开/恢复,且恢复后旧字段清干净', () => {
  let b = start(card({ collapsed: true, expandedHeight: 480, height: COLLAPSED_HEIGHT }))
  const p = restorePatch(b.nodes[0]); assert.equal(p.height, 480)
  b = apply(b, b.nodes[0], p)
  assert.ok(!('collapsed' in b.nodes[0]) && !('expandedHeight' in b.nodes[0]) && !('fold' in b.nodes[0]) && !('baseHeight' in b.nodes[0]))
})

test('经 applyOps 往返:折叠/展开/恢复后字段被清理干净,不残留 null', () => {
  let b = start(card({ height: 400 }))
  b = apply(b, b.nodes[0], collapsePatch(b.nodes[0])); assert.equal(b.nodes[0].height, COLLAPSED_HEIGHT); assert.equal(b.nodes[0].fold, 'collapsed')
  b = apply(b, b.nodes[0], expandPatch(b.nodes[0], 650)); assert.equal(b.nodes[0].height, 650); assert.equal(b.nodes[0].baseHeight, 400)
  b = apply(b, b.nodes[0], restorePatch(b.nodes[0])); assert.equal(b.nodes[0].height, 400)
  assert.ok(!('fold' in b.nodes[0]) && !('baseHeight' in b.nodes[0]) && !('collapsed' in b.nodes[0]) && !('expandedHeight' in b.nodes[0]))
})

test('ops 校验:fold 只能是 collapsed/expanded;baseHeight 必须是正数', () => {
  const b = start(card())
  for (const bad of ['default', 'x', 1, true]) assert.throws(() => apply(b, b.nodes[0], { fold: bad }), OpError, String(bad))
  for (const bad of [0, -1, NaN, 'a', Infinity]) assert.throws(() => apply(b, b.nodes[0], { baseHeight: bad }), OpError, String(bad))
  assert.doesNotThrow(() => apply(b, b.nodes[0], { fold: 'collapsed', baseHeight: 300 }))
  assert.doesNotThrow(() => apply(b, b.nodes[0], { fold: null, baseHeight: null }))        // null = 清除
})

test('撤销:折叠/展开/拖拽各自一步还原(逆操作取应用前的字段)', () => {
  const inv = (before, patch) => { const n = before.nodes[0]; const r = {}; for (const k of Object.keys(patch)) r[k] = k in n ? n[k] : null; return r }
  let b = start(card({ height: 500 }))
  const p = collapsePatch(b.nodes[0]); const undo = inv(b, p)
  b = apply(b, b.nodes[0], p); b = apply(b, b.nodes[0], undo)
  assert.equal(b.nodes[0].height, 500); assert.ok(!('fold' in b.nodes[0]) && !('baseHeight' in b.nodes[0]))
})
