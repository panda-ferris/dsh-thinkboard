import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeMarkdown, neutralizeDeadLinks, isHighlightColor, backgroundToMark, preprocessPastedHtml, calloutToExternalHtml, imageDecision, INLINE_IMAGE_MAX } from '../src/core/clipboard.js'

test('looksLikeMarkdown: 标题、围栏代码、表格、callout 是强特征,单个就算', () => {
  for (const s of ['# 标题', '正文\n\n## 小节\n更多', '```js\nx=1\n```', '| a | b |\n| --- | --- |\n| 1 | 2 |', '> [!note] 提示\n> 内容', '| a |\n|---|\n| 1 |']) assert.equal(looksLikeMarkdown(s), true, JSON.stringify(s))
})

test('looksLikeMarkdown: 多行列表 / 多行引用算(≥2 个结构行)', () => {
  assert.equal(looksLikeMarkdown('- 一\n- 二'), true); assert.equal(looksLikeMarkdown('1. 甲\n2. 乙'), true); assert.equal(looksLikeMarkdown('> 引一\n> 引二'), true)
  assert.equal(looksLikeMarkdown('- [ ] 待办\n- [x] 完成'), true)
})

test('looksLikeMarkdown: 普通文字不解析(单行、没有结构)', () => {
  for (const s of ['随便一句话', '今天天气不错,去 a/b 目录看看', '价格是 3*4=12 元', '邮箱 a@b.com', '用 ==> 表示推导', 'a == b', '']) assert.equal(looksLikeMarkdown(s), false, JSON.stringify(s))
})

test('looksLikeMarkdown: 单行的 "- 开头" 或 "1. 开头" 不算(很可能是随手打的一句话)', () => {
  assert.equal(looksLikeMarkdown('- 就这一行'), false); assert.equal(looksLikeMarkdown('1. 就这一行'), false); assert.equal(looksLikeMarkdown('> 一句引用'), false)
})

test('looksLikeMarkdown: 单行里的行内格式不足以判定;多种行内格式才算', () => {
  assert.equal(looksLikeMarkdown('这是 **粗体** 文字'), false); assert.equal(looksLikeMarkdown('看 [链接](https://a.com)'), false)
  assert.equal(looksLikeMarkdown('**粗** 与 [链接](https://a.com)'), true); assert.equal(looksLikeMarkdown('==高亮== 与 `code`'), true)
})

test('looksLikeMarkdown: 一个结构行 + 行内格式(多行文本)算', () => {
  assert.equal(looksLikeMarkdown('- 要点\n这是 **重点**'), true)
})

test('looksLikeMarkdown: 非字符串、空白、超大文本不解析;CRLF 换行也识别', () => {
  for (const bad of [null, undefined, 5, {}, '   \n  ']) assert.equal(looksLikeMarkdown(bad), false)
  assert.equal(looksLikeMarkdown('x'.repeat(200_001)), false)
  assert.equal(looksLikeMarkdown('# 标题\r\n\r\n正文'), true)
})

test('looksLikeMarkdown: 有序列表的 1) 写法、缩进列表', () => {
  assert.equal(looksLikeMarkdown('1) 甲\n2) 乙'), true); assert.equal(looksLikeMarkdown('- 一\n  - 二'), true)
})

test('neutralizeDeadLinks: KM 的 source_id 链接变成不可点击的占位文字', () => {
  const out = neutralizeDeadLinks('<p><a href="source_id:6ed8f3d5-6bd3">[图片: image.png]</a></p>')
  assert.ok(!out.includes('href') && out.includes('[图片: image.png(来自外部文档,无法导入)]'), out)
})

test('neutralizeDeadLinks: 正常链接不动;file:/blob: 也算死链接', () => {
  assert.equal(neutralizeDeadLinks('<a href="https://a.com">x</a>'), '<a href="https://a.com">x</a>')
  assert.ok(!neutralizeDeadLinks('<a href="blob:abc">图</a>').includes('href'))
  assert.ok(!neutralizeDeadLinks("<a href='file:///a.png'>图</a>").includes('href'))
})

test('neutralizeDeadLinks: 链接文字里的标签被清掉;没有文字时用"图片"', () => {
  assert.ok(neutralizeDeadLinks('<a href="source_id:x"><b>[图片: a]</b></a>').includes('[图片: a'))
  assert.ok(neutralizeDeadLinks('<a href="source_id:x"></a>').includes('[图片('))
})

test('isHighlightColor: 荧光色(黄/绿/粉/橙)算,白/灰/黑/透明不算', () => {
  for (const c of ['rgb(255,246,122)', '#fff59d', '#ff0', 'yellow', 'rgb(144,238,144)', 'rgba(255, 235, 59, 0.8)', '#ffcdd2', 'orange']) assert.equal(isHighlightColor(c), true, c)
  for (const c of ['white', '#fff', '#ffffff', 'rgb(240,240,240)', 'rgb(128,128,128)', '#000', 'rgb(30,30,60)', 'transparent', 'inherit', '', null, undefined, 'rgba(255,255,0,0.05)', 'none', 'var(--x)']) assert.equal(isHighlightColor(c), false, String(c))
})

test('backgroundToMark: 带荧光底色的 span 变 <mark>;保留内部格式', () => {
  assert.equal(backgroundToMark('<span style="background-color:rgb(255,246,122)">重点</span>'), '<mark>重点</mark>')
  assert.equal(backgroundToMark('<span style="color:red;background:#fff59d">a<b>b</b></span>'), '<mark>a<b>b</b></mark>')
})

test('backgroundToMark: 白底/灰底/透明、没有背景色的 span 不动;块级元素的背景色不动', () => {
  for (const h of ['<span style="background-color:#fff">x</span>', '<span style="background:rgb(240,240,240)">x</span>', '<span style="color:red">x</span>', '<span>x</span>', '<div style="background:yellow">整段</div>']) assert.equal(backgroundToMark(h), h)
})

test('backgroundToMark: 同一段里多个高亮、与普通 span 混排', () => {
  const out = backgroundToMark('<span style="background:yellow">一</span> 普通 <span style="font-weight:700">粗</span> <span style="background:#ff0">二</span>')
  assert.equal(out, '<mark>一</mark> 普通 <span style="font-weight:700">粗</span> <mark>二</mark>')
})

test('preprocessPastedHtml: 两条规则一起生效;空/非法输入返回空串', () => {
  const out = preprocessPastedHtml('<span style="background:yellow">高亮</span><a href="source_id:z">[图片: p]</a>')
  assert.ok(out.includes('<mark>高亮</mark>') && !out.includes('source_id'))
  for (const bad of ['', null, undefined, 5]) assert.equal(preprocessPastedHtml(bad), '')
})

test('calloutToExternalHtml: 输出引用块 + 内联样式(颜色、左边框、底色),不含我们的 class', () => {
  const h = calloutToExternalHtml({ color: 'orange', title: '注意', bodyHtml: '<p>小心</p>' })
  assert.ok(h.startsWith('<blockquote style="') && h.includes('#f97316') && h.includes('border-left:4px solid') && h.includes('rgba(249,115,22,0.1)'))
  assert.ok(h.includes('注意') && h.includes('<p>小心</p>') && !h.includes('class=') && !/class=|"wb-callout"|wb-callout-(body|icon)/.test(h))   // 没有我们的 class 名;只剩粘回本应用用的 data- 标记(外部软件会忽略)
})

test('calloutToExternalHtml: 标题转义;没有标题时不输出标题行;未知颜色回退蓝色', () => {
  assert.ok(calloutToExternalHtml({ title: '<b>&"x' }).includes('&lt;b&gt;&amp;&quot;x'))
  assert.ok(!calloutToExternalHtml({ title: '', bodyHtml: '<p>x</p>' }).includes('font-weight:600'))
  assert.ok(calloutToExternalHtml({ color: 'nope', title: 't' }).includes('#3b82f6'))
})

test('imageDecision: 远程保留;本地 assets 在大小限制内内嵌,超限降级为文字;未知来源降级', () => {
  assert.equal(imageDecision('https://a.com/x.png'), 'keep')
  assert.equal(imageDecision('assets/a.png', { size: 1000 }), 'inline'); assert.equal(imageDecision('assets/a.png', { size: INLINE_IMAGE_MAX }), 'inline')
  assert.equal(imageDecision('assets/a.png', { size: INLINE_IMAGE_MAX + 1 }), 'text')
  assert.equal(imageDecision('/api/thinkboard/asset?board=b&file=assets%2Fa.png', { size: 10 }), 'inline')
  assert.equal(imageDecision('weird://x'), 'text'); assert.equal(imageDecision(''), 'text'); assert.equal(imageDecision(null), 'text')
})

test('imageDecision: data URL 小的保留、大的降级', () => {
  assert.equal(imageDecision('data:image/png;base64,AAAA'), 'keep')
  assert.equal(imageDecision('data:image/png;base64,' + 'A'.repeat(INLINE_IMAGE_MAX * 2)), 'text')
})

test('表格分隔行:单列 |---| 算表格;单独的 --- 是分割线(也算 Markdown 结构,但不是表格)', () => {
  assert.equal(looksLikeMarkdown('| a |\n|---|\n| 1 |'), true)
  assert.equal(looksLikeMarkdown('---'), false)            // 单行分割线本身不足以判定
  assert.equal(looksLikeMarkdown('前文\n\n---\n\n后文\n\n- 项一\n- 项二'), true)
  assert.equal(looksLikeMarkdown('a | b\n--- | ---\n1 | 2'), true)      // 没有首尾竖线的写法
})

test('calloutToExternalHtml: 带类型时输出 data-wb-callout 标记(粘回本应用可还原),不合法的类型名不输出任何标记', () => {
  const h = calloutToExternalHtml({ color: 'red', title: 'T', bodyHtml: '<p>x</p>', type: 'danger', fold: 'closed' })
  assert.ok(h.startsWith('<blockquote data-wb-callout="danger" data-wb-callout-fold="closed" style="'), h)
  assert.ok(h.includes('<p data-wb-callout-title style='))
  for (const bad of ['a"b', '<x>', 'a b', '', 'x'.repeat(41)]) assert.ok(!calloutToExternalHtml({ type: bad, title: 't' }).includes('data-wb-callout="'), bad)
  assert.ok(!calloutToExternalHtml({ type: 'note', fold: 'bad' }).includes('data-wb-callout-fold'))
})

test('表头样式不带 font-weight(否则粘回编辑器时被识别成粗体)', async () => {
  const { HEAD_STYLE, CELL_STYLE } = await import('../src/core/clipboard.js')
  assert.ok(!/font-weight/.test(HEAD_STYLE) && /background:#f3f3f3/.test(HEAD_STYLE) && HEAD_STYLE.startsWith(CELL_STYLE))
})
