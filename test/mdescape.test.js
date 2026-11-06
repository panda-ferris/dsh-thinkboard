import test from 'node:test'
import assert from 'node:assert/strict'
import { leadingEscapeIndex, markLeadingMarkers, resolveSentinel, SENTINEL } from '../src/core/mdescape.js'

test('leadingEscapeIndex: 标题、无序列表、有序列表(转义 . 或 ))、分割线需要转义', () => {
  assert.equal(leadingEscapeIndex('# 标题'), 0); assert.equal(leadingEscapeIndex('###### x'), 0); assert.equal(leadingEscapeIndex('#'), 0)
  assert.equal(leadingEscapeIndex('- 项'), 0); assert.equal(leadingEscapeIndex('+ 项'), 0); assert.equal(leadingEscapeIndex('-'), 0)
  assert.equal(leadingEscapeIndex('1. 背景'), 1); assert.equal(leadingEscapeIndex('12) 次'), 2); assert.equal(leadingEscapeIndex('2024. 年报'), 4)
  assert.equal(leadingEscapeIndex('---'), 0); assert.equal(leadingEscapeIndex('=== '), 0); assert.equal(leadingEscapeIndex('+++'), 0)
})

test('leadingEscapeIndex: 普通文字不需要转义(#标签、负数、版本号、小数、7 个 #)', () => {
  for (const s of ['#标签', '#hashtag', '-5 度', '-x', '1.5 倍', '3.14', 'v1. 版本', '1.背景', '####### 七个', '1234567890. 超长', '价格 - 10', '普通文字', '']) assert.equal(leadingEscapeIndex(s), -1, JSON.stringify(s))
})

const para = (...c) => ({ type: 'paragraph', content: c })
const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })

test('markLeadingMarkers: 在段落首个文本里插入哨兵,位置正确', () => {
  const out = markLeadingMarkers({ type: 'doc', content: [para(txt('# 不是标题')), para(txt('1. 背景 与更多'))] })
  assert.equal(out.content[0].content[0].text, SENTINEL + '# 不是标题')
  assert.equal(out.content[1].content[0].text, '1' + SENTINEL + '. 背景 与更多')
})

test('markLeadingMarkers: 不修改入参(返回新对象,未改动的路径复用)', () => {
  const doc = { type: 'doc', content: [para(txt('# x')), para(txt('普通'))] }
  const snap = JSON.stringify(doc)
  const out = markLeadingMarkers(doc)
  assert.equal(JSON.stringify(doc), snap); assert.notEqual(out, doc); assert.equal(out.content[1], doc.content[1])
})

test('markLeadingMarkers: 没有需要转义的内容时原样返回同一个对象', () => {
  const doc = { type: 'doc', content: [para(txt('普通文字')), { type: 'heading', attrs: { level: 1 }, content: [txt('标题')] }] }
  assert.equal(markLeadingMarkers(doc), doc)
})

test('markLeadingMarkers: 带格式的首个文本(粗体等)不处理 —— "**# x**" 本来就不是标题', () => {
  const doc = { type: 'doc', content: [para(txt('# 粗', [{ type: 'bold' }]))] }
  assert.equal(markLeadingMarkers(doc), doc)
})

test('markLeadingMarkers: 只处理段落的"第一个"节点;段落中间、其它块类型(标题、代码块)不动', () => {
  const doc = { type: 'doc', content: [para(txt('前文 '), txt('# 中间', [{ type: 'bold' }])), { type: 'heading', attrs: { level: 2 }, content: [txt('# 标题里')] }, { type: 'codeBlock', content: [txt('# 代码')] }] }
  assert.equal(markLeadingMarkers(doc), doc)
})

test('markLeadingMarkers: 嵌套结构里的段落(列表项、引用、表格单元格)也处理', () => {
  const doc = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para(txt('- 嵌套'))] }] }, { type: 'blockquote', content: [para(txt('1. 引用里'))] }] }
  const out = markLeadingMarkers(doc)
  assert.equal(out.content[0].content[0].content[0].content[0].text, SENTINEL + '- 嵌套')
  assert.equal(out.content[1].content[0].content[0].text, '1' + SENTINEL + '. 引用里')
})

test('markLeadingMarkers: 空段落、缺字段、非对象不抛错', () => {
  for (const d of [null, undefined, 5, 'x', {}, { type: 'doc' }, { type: 'doc', content: [para()] }, { type: 'doc', content: [{ type: 'paragraph' }] }]) assert.doesNotThrow(() => markLeadingMarkers(d))
})

test('resolveSentinel: 哨兵换成反斜杠;没有哨兵不变', () => {
  assert.equal(resolveSentinel(SENTINEL + '# 标题'), '\\# 标题'); assert.equal(resolveSentinel('1' + SENTINEL + '. 背景'), '1\\. 背景'); assert.equal(resolveSentinel('普通'), '普通')
})
