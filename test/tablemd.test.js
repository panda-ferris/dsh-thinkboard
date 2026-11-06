import test from 'node:test'
import assert from 'node:assert/strict'
import { isComplexCell, isComplexTable, tableToHtml, complexTableMarkdown, hasCustomWidths, cleanColwidth, COL_MIN, COL_MAX, draggedColWidth } from '../src/core/tablemd.js'

const p = (...c) => ({ type: 'paragraph', content: c.map((t) => (typeof t === 'string' ? { type: 'text', text: t } : t)) })
const li = (...blocks) => ({ type: 'listItem', content: blocks })
const ul = (...items) => ({ type: 'bulletList', content: items })
const ol = (...items) => ({ type: 'orderedList', attrs: { start: 1 }, content: items })
const cell = (...blocks) => ({ type: 'tableCell', attrs: {}, content: blocks })
const head = (...blocks) => ({ type: 'tableHeader', attrs: {}, content: blocks })
const row = (...cells) => ({ type: 'tableRow', content: cells })
const table = (...rows) => ({ type: 'table', content: rows })

test('简单表格:每格一个普通段落 → 不是复杂表格(走 GFM)', () => {
  const t = table(row(head(p('a')), head(p('b'))), row(cell(p('1')), cell(p('2'))))
  assert.equal(isComplexTable(t), false); assert.equal(complexTableMarkdown(t), null)
})

test('空单元格与带行内格式的单元格仍是简单的', () => {
  assert.equal(isComplexCell({ type: 'tableCell', content: [] }), false)
  assert.equal(isComplexCell(cell(p({ type: 'text', text: 'x', marks: [{ type: 'bold' }] }))), false)
})

test('含无序列表 / 有序列表 / 任务列表 / 代码块 / 引用 → 复杂', () => {
  for (const b of [ul(li(p('a'))), ol(li(p('a'))), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('a')] }] }, { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }, { type: 'blockquote', content: [p('q')] }]) {
    assert.equal(isComplexCell(cell(b)), true, b.type)
  }
})

test('单元格里有多个块、或段落里有硬换行 → 复杂', () => {
  assert.equal(isComplexCell(cell(p('a'), p('b'))), true)
  assert.equal(isComplexCell(cell(p('a', { type: 'hardBreak' }, 'b'))), true)
})

test('只要有一个单元格复杂,整张表都存成 HTML', () => {
  const t = table(row(head(p('a')), head(p('b'))), row(cell(p('简单')), cell(p('x'), ul(li(p('列表'))))))
  assert.equal(isComplexTable(t), true)
  const md = complexTableMarkdown(t)
  assert.ok(md.startsWith('\n<table>') && md.endsWith('</table>\n'))
})

test('HTML 里保留嵌套列表的层级(KM / 飞书粘贴的场景)', () => {
  const t = table(row(head(p('a'))), row(cell(
    p('实验看板'),
    ul(li(p('RTA 实验'))),
    ol(li(p('分渠道')), li(p('号码包'), ul(li(p('子项'))))),
  )))
  const html = tableToHtml(t)
  assert.ok(html.includes('<p>实验看板</p><ul><li><p>RTA 实验</p></li></ul>'))
  assert.ok(html.includes('<ol><li><p>分渠道</p></li><li><p>号码包</p><ul><li><p>子项</p></li></ul></li></ol>'))
})

test('HTML 是单行(不含换行),不会被 Markdown 的空行规则截断', () => {
  const t = table(row(cell(p('a'), p('b'))))
  assert.ok(!tableToHtml(t).includes('\n'))
  assert.ok(!tableToHtml(table(row(cell(p('x\ny'))))).includes('\n\n'))
})

test('特殊字符被转义:< > & " 不会破坏结构或注入标签', () => {
  const t = table(row(cell(p('<script>alert(1)</script> & "x"'), ul(li(p('a<b'))))))
  const html = tableToHtml(t)
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&amp;')); assert.ok(html.includes('a&lt;b'))
})

test('行内标记:粗体、斜体、链接、代码、删除线、下划线都保留;嵌套顺序固定', () => {
  const m = (type, attrs) => ({ type, ...(attrs ? { attrs } : {}) })
  const t = table(row(cell(p({ type: 'text', text: 'x', marks: [m('italic'), m('bold'), m('link', { href: 'https://a.com?q="1"&b=2' })] }), ul(li(p({ type: 'text', text: 'c', marks: [m('code')] }))))))
  const html = tableToHtml(t)
  assert.ok(html.includes('<a href="https://a.com?q=&quot;1&quot;&amp;b=2"><strong><em>x</em></strong></a>'), html)
  assert.ok(html.includes('<code>c</code>'))
  const reversed = table(row(cell(p({ type: 'text', text: 'x', marks: [m('link', { href: 'https://a.com?q="1"&b=2' }), m('bold'), m('italic')] }), ul(li(p('c'))))))
  assert.equal(tableToHtml(reversed).match(/<td>.*?<ul>/)[0], tableToHtml(t).match(/<td>.*?<ul>/)[0], '标记顺序不同的相同内容序列化一致')
})

test('有序列表的起始序号、任务列表的勾选状态、表头、对齐与合并单元格都保留', () => {
  const t = table(
    row({ type: 'tableHeader', attrs: { align: 'center', colspan: 2 }, content: [p('头')] }),
    row(cell({ type: 'orderedList', attrs: { start: 3 }, content: [li(p('c'))] }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('done')] }, { type: 'taskItem', attrs: { checked: false }, content: [p('todo')] }] })),
  )
  const html = tableToHtml(t)
  assert.ok(html.includes('<th colspan="2" style="text-align:center">')); assert.ok(html.includes('<ol start="3">'))
  assert.ok(html.includes('data-checked="true"') && html.includes('data-checked="false"'))
})

test('空表格、缺字段的节点不会抛错', () => {
  assert.equal(tableToHtml({ type: 'table' }), '<table><tbody></tbody></table>')
  assert.equal(isComplexTable({ type: 'table' }), false); assert.equal(isComplexTable(null), false)
  assert.doesNotThrow(() => tableToHtml(table(row({ type: 'tableCell' }))))
})

test('单元格里的高亮块(callout):输出带类型/标题/折叠的结构,不退化成普通引用', () => {
  const co = (attrs, ...blocks) => ({ type: 'blockquote', attrs, content: blocks })
  const html = tableToHtml(table(row(cell(co({ calloutType: 'warning', calloutFold: 'closed', calloutTitle: '注意' }, p('正文'))))))
  assert.ok(html.includes('class="wb-callout"') && html.includes('data-callout="warning"') && html.includes('data-callout-color="orange"') && html.includes('data-fold="closed"'))
  assert.ok(html.includes('<span class="wb-callout-title-text">注意</span>') && html.includes('<div class="wb-callout-body"><p>正文</p></div>'))
  assert.ok(!html.includes('<blockquote>'))
})

test('单元格里的高亮块没写标题:标题栏显示类型名;普通引用仍是 <blockquote>', () => {
  const co = (attrs, ...blocks) => ({ type: 'blockquote', attrs, content: blocks })
  assert.ok(tableToHtml(table(row(cell(co({ calloutType: 'tip' }, p('x')))))).includes('>Tip</span>'))
  assert.ok(tableToHtml(table(row(cell(co({}, p('引用')))))).includes('<blockquote><p>引用</p></blockquote>'))
})

test('单元格里的高亮块:类型名不合法(含引号/尖括号等)时不输出任何 callout 属性,按普通引用处理,内容保留', () => {
  for (const bad of ['a"b', '<x>', 'a b', 'x"onmouseover="alert(1)', '']) {
    const co = { type: 'blockquote', attrs: { calloutType: bad, calloutTitle: '<x>' }, content: [p('内容')] }
    const html = tableToHtml(table(row(cell(co))))
    assert.ok(!html.includes('wb-callout') && !html.includes('data-callout'), `${bad} → ${html}`)
    assert.ok(html.includes('<blockquote><p>内容</p></blockquote>'), html)
  }
})

test('单元格里的高亮块:标题里的 < > & 被转义(类型合法时)', () => {
  const co = { type: 'blockquote', attrs: { calloutType: 'note', calloutTitle: '<b>&x' }, content: [p('x')] }
  const html = tableToHtml(table(row(cell(co))))
  assert.ok(html.includes('&lt;b&gt;&amp;x') && !html.includes('<b>'), html)
})

test('行内高亮标记在表格 HTML 里输出为 <mark>,与其它标记嵌套顺序固定', () => {
  const t = table(row(cell(p({ type: 'text', text: 'x', marks: [{ type: 'highlight' }, { type: 'bold' }] }), ul(li(p('a'))))))
  assert.ok(tableToHtml(t).includes('<strong><mark>x</mark></strong>'), tableToHtml(t))
})

const wcell = (w, ...blocks) => ({ type: 'tableCell', attrs: { colwidth: w }, content: blocks.length ? blocks : [p('x')] })
const whead = (w, ...blocks) => ({ type: 'tableHeader', attrs: { colwidth: w }, content: blocks.length ? blocks : [p('h')] })

test('cleanColwidth: 合法值取整并夹到范围内;没有有效宽度返回 null', () => {
  assert.deepEqual(cleanColwidth([240]), [240]); assert.deepEqual(cleanColwidth([100.6, 80]), [101, 80])
  assert.deepEqual(cleanColwidth([5]), [COL_MIN]); assert.deepEqual(cleanColwidth([99999]), [COL_MAX])
  for (const bad of [null, undefined, [], 240, '240', {}, [null], [0], [NaN], [-5], ['abc']]) assert.equal(cleanColwidth(bad), null, JSON.stringify(bad))
})

test('cleanColwidth: 合并单元格里部分列没设宽用 0 占位,保持列数对齐', () => {
  assert.deepEqual(cleanColwidth([200, null]), [200, 0]); assert.deepEqual(cleanColwidth([0, 150]), [0, 150])
})

test('手动调过列宽的简单表格:不再走 GFM(GFM 存不下宽度),整张表存成 HTML', () => {
  const t = table(row(whead([200]), whead([120])), row(wcell([200]), wcell([120])))
  assert.equal(hasCustomWidths(t), true); assert.equal(isComplexTable(t), true)
  const md = complexTableMarkdown(t); assert.ok(md.includes('<table>') && md.includes('colwidth="200"') && md.includes('colwidth="120"'), md)
})

test('没调过列宽的简单表格:仍走 GFM(不无谓转成 HTML)', () => {
  for (const w of [null, undefined, [], [0]]) {
    const t = table(row(whead(w), whead(w)), row(wcell(w), wcell(w)))
    assert.equal(hasCustomWidths(t), false); assert.equal(isComplexTable(t), false); assert.equal(complexTableMarkdown(t), null)
  }
})

test('只有一列调过宽:整张表存 HTML,没调的列不输出 colwidth', () => {
  const t = table(row(whead([180]), whead(null)), row(wcell([180]), wcell(null)))
  const html = tableToHtml(t)
  assert.equal((html.match(/colwidth=/g) || []).length, 2)   // 两行各一个,表头与正文的第一列
  assert.ok(html.includes('<th colwidth="180"><p>h</p></th><th><p>h</p></th>'), html)
})

test('colwidth 与 colspan、对齐一起输出,属性顺序固定', () => {
  const c = { type: 'tableHeader', attrs: { colspan: 2, colwidth: [100, 80], align: 'center' }, content: [p('跨列')] }
  assert.ok(tableToHtml(table(row(c))).includes('<th colspan="2" colwidth="100,80" style="text-align:center">'))
})

test('列宽数值被规整后输出(越界夹住、小数取整),不会输出非法值', () => {
  const html = tableToHtml(table(row(whead([3]), whead([99999.4])), row(wcell([3]), wcell([99999.4]))))
  assert.ok(html.includes(`colwidth="${COL_MIN}"`) && html.includes(`colwidth="${COL_MAX}"`) && !html.includes('NaN') && !html.includes('99999'))
})

test('既有复杂内容(列表)又有列宽:两者都保留', () => {
  const t = table(row(whead([150])), row(wcell([150], p('x'), ul(li(p('项'))))))
  const html = tableToHtml(t); assert.ok(html.includes('colwidth="150"') && html.includes('<ul><li><p>项</p></li></ul>'))
})

test('draggedColWidth: 缩放 100% 时屏幕位移即列宽增量', () => { assert.equal(draggedColWidth(150, 100, 1), 250); assert.equal(draggedColWidth(150, -50, 1), 100) })

test('draggedColWidth: 画布缩放时按比例换算,手柄始终跟手', () => {
  assert.equal(draggedColWidth(150, 60, 0.6), 250)        // 缩小到 60%:屏幕上 60px = world 100
  assert.equal(draggedColWidth(150, 150, 1.5), 250)       // 放大到 150%:屏幕上 150px = world 100
  assert.equal(draggedColWidth(150, 100, 0.5), 350)
})

test('draggedColWidth: 夹在 [COL_MIN, COL_MAX],结果取整', () => {
  assert.equal(draggedColWidth(100, -5000, 1), COL_MIN); assert.equal(draggedColWidth(100, 99999, 1), COL_MAX)
  assert.equal(draggedColWidth(100, 33.3, 0.7), Math.round(100 + 33.3 / 0.7))
  assert.ok(Number.isInteger(draggedColWidth(101.5, 10.2, 0.9)))
})

test('draggedColWidth: 缩放比例非法(0、负、NaN)按 1 处理;起点非法不返回 NaN', () => {
  for (const k of [0, -1, NaN, undefined, null]) assert.equal(draggedColWidth(150, 100, k), 250, String(k))
  assert.ok(Number.isFinite(draggedColWidth(NaN, 10, 1))); assert.ok(Number.isFinite(draggedColWidth(100, NaN, 1)))
})
