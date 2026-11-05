import test from 'node:test'
import assert from 'node:assert/strict'
import { isComplexCell, isComplexTable, tableToHtml, complexTableMarkdown } from '../src/core/tablemd.js'

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
