import test from 'node:test'
import assert from 'node:assert/strict'
import { CALLOUT_TYPES, canonicalType, isKnownType, parseCalloutHead, formatCalloutHead, defaultTitle, splitFirstLine, isValidType } from '../src/core/callout.js'

test('13 个 Obsidian 内置类型齐全', () => {
  assert.deepEqual(CALLOUT_TYPES.map((t) => t.id), ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'])
})

test('别名映射到规范类型(与 Obsidian 文档一致)', () => {
  const exp = { summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' }
  for (const [alias, id] of Object.entries(exp)) assert.equal(canonicalType(alias).id, id, alias)
})

test('类型不区分大小写;未知类型回退为 note 的样式', () => {
  assert.equal(canonicalType('WARNING').id, 'warning'); assert.equal(canonicalType('Tip').id, 'tip')
  assert.equal(canonicalType('my-custom').id, 'note'); assert.equal(canonicalType(undefined).id, 'note')
  assert.ok(isKnownType('TLDR')); assert.ok(!isKnownType('my-custom'))
})

test('parseCalloutHead:类型 + 标题', () => {
  assert.deepEqual(parseCalloutHead('[!info] Here is a title'), { type: 'info', fold: null, title: 'Here is a title' })
  assert.deepEqual(parseCalloutHead('[!tip]'), { type: 'tip', fold: null, title: '' })
  assert.deepEqual(parseCalloutHead('[!note] 中文标题 含 空格'), { type: 'note', fold: null, title: '中文标题 含 空格' })
})

test('parseCalloutHead:折叠标记 +/- 紧跟在类型之后', () => {
  assert.deepEqual(parseCalloutHead('[!faq]- Are callouts foldable?'), { type: 'faq', fold: 'closed', title: 'Are callouts foldable?' })
  assert.deepEqual(parseCalloutHead('[!faq]+ 默认展开'), { type: 'faq', fold: 'open', title: '默认展开' })
  assert.deepEqual(parseCalloutHead('[!tip]-'), { type: 'tip', fold: 'closed', title: '' })
})

test('parseCalloutHead:保留类型的原始大小写与自定义类型名(用于往返)', () => {
  assert.equal(parseCalloutHead('[!Warning] x').type, 'Warning')
  assert.equal(parseCalloutHead('[!custom-question_type] x').type, 'custom-question_type')
})

test('parseCalloutHead:类型与标题之间允许多个空格或制表符(Obsidian 文档示例里有两个空格)', () => {
  assert.equal(parseCalloutHead('[!example]  You can even use').title, 'You can even use')
  assert.equal(parseCalloutHead('[!note]\t标题').title, '标题')
})

test('parseCalloutHead:不是 callout 的写法返回 null', () => {
  for (const s of ['普通引用', '[!]', '[! note] x', '[!note]标题', '[note] x', '[!no te] x', '!note x', '', null, undefined]) assert.equal(parseCalloutHead(s), null, String(s))
})

test('parseCalloutHead:行尾空白被忽略', () => { assert.deepEqual(parseCalloutHead('[!tip] 标题   '), { type: 'tip', fold: null, title: '标题' }) })

test('formatCalloutHead 与 parseCalloutHead 往返一致', () => {
  for (const h of [{ type: 'info', fold: null, title: 'T' }, { type: 'faq', fold: 'closed', title: '' }, { type: 'Warning', fold: 'open', title: '中文 标题' }, { type: 'x-y_z', fold: null, title: '' }]) {
    assert.deepEqual(parseCalloutHead(formatCalloutHead(h)), h)
  }
  assert.equal(formatCalloutHead({ type: 'tip', fold: 'closed', title: '' }), '[!tip]-')
})

test('defaultTitle:类型名首字母大写', () => {
  assert.equal(defaultTitle('warning'), 'Warning'); assert.equal(defaultTitle('TIP'), 'Tip'); assert.equal(defaultTitle(), 'Note')
})

test('splitFirstLine', () => {
  assert.deepEqual(splitFirstLine('a\nb\nc'), { first: 'a', rest: 'b\nc' })
  assert.deepEqual(splitFirstLine('只有一行'), { first: '只有一行', rest: '' })
  assert.deepEqual(splitFirstLine(''), { first: '', rest: '' })
})

test('isValidType:字符集与长度', () => {
  assert.ok(isValidType('note') && isValidType('a-b_c9') && isValidType('x'.repeat(40)))
  for (const bad of ['', 'a b', 'a]b', 'x'.repeat(41), '中文', null, 5]) assert.ok(!isValidType(bad), String(bad))
})
