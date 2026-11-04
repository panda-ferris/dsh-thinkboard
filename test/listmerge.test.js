import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { findJoinPoints, mergeAdjacentLists } from '../src/core/listmerge.js'

// 最小 schema:doc > (paragraph | ol | ul | blockquote)+ ;li > paragraph block*
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    orderedList: { group: 'block', content: 'listItem+', toDOM: () => ['ol', 0] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
    listItem: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    blockquote: { group: 'block', content: 'block+', toDOM: () => ['blockquote', 0] },
  },
})
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null)
const li = (t, ...kids) => schema.nodes.listItem.create(null, [p(t), ...kids])
const ol = (...items) => schema.nodes.orderedList.create(null, items)
const ul = (...items) => schema.nodes.bulletList.create(null, items)
const mk = (...blocks) => EditorState.create({ schema, doc: schema.nodes.doc.create(null, blocks) })
const shape = (n) => (n.type.name === 'paragraph' ? 'p' : n.type.name === 'listItem' ? 'li' : n.type.name === 'orderedList' ? `ol(${kids(n)})` : n.type.name === 'bulletList' ? `ul(${kids(n)})` : `${n.type.name}(${kids(n)})`)
const kids = (n) => { const out = []; n.forEach((c) => out.push(shape(c))); return out.join(',') }
const docShape = (doc) => kids(doc)
const run = (state) => { const tr = state.tr; const changed = mergeAdjacentLists(tr); return { changed, doc: tr.doc } }

test('两个紧挨着的有序列表合并为一个,条目保持顺序', () => {
  const { changed, doc } = run(mk(ol(li('甲'), li('乙')), ol(li('丙'), li('丁'))))
  assert.equal(changed, true)
  assert.equal(docShape(doc), 'ol(li,li,li,li)')
  const texts = []; doc.descendants((n) => { if (n.isText) texts.push(n.text) })
  assert.deepEqual(texts, ['甲', '乙', '丙', '丁'])
})

test('无序列表同样合并', () => {
  assert.equal(docShape(run(mk(ul(li('a')), ul(li('b')))).doc), 'ul(li,li)')
})

test('类型不同(有序 + 无序)不合并', () => {
  const r = run(mk(ol(li('a')), ul(li('b'))))
  assert.equal(r.changed, false); assert.equal(docShape(r.doc), 'ol(li),ul(li)')
})

test('被段落隔开的不合并', () => {
  const r = run(mk(ol(li('a')), p('隔'), ol(li('b'))))
  assert.equal(r.changed, false); assert.equal(docShape(r.doc), 'ol(li),p,ol(li)')
})

test('三个连续列表一次全部合并', () => {
  assert.equal(docShape(run(mk(ol(li('a')), ol(li('b')), ol(li('c')))).doc), 'ol(li,li,li)')
})

test('合并后保留各项的子列表', () => {
  const r = run(mk(ol(li('甲', ol(li('子')))), ol(li('乙'))))
  assert.equal(docShape(r.doc), 'ol(li,li)')
  let nested = 0; r.doc.descendants((n) => { if (n.type.name === 'orderedList') nested++ })
  assert.equal(nested, 2) // 外层 1 + 子列表 1
})

test('列表项内部相邻的子列表也合并(嵌套位置)', () => {
  const state = mk(ol(li('甲', ol(li('子一')), ol(li('子二')))))
  const r = run(state)
  assert.equal(r.changed, true)
  let inner = 0; r.doc.descendants((n, pos, parent) => { if (n.type.name === 'orderedList' && parent?.type.name === 'listItem') inner++ })
  assert.equal(inner, 1)
})

test('引用块内相邻列表也合并;不同父节点之间不跨界合并', () => {
  const r = run(mk(schema.nodes.blockquote.create(null, [ol(li('a')), ol(li('b'))]), ol(li('c'))))
  assert.equal(docShape(r.doc), 'blockquote(ol(li,li)),ol(li)')
})

test('已经是单个列表时没有改动', () => {
  const r = run(mk(ol(li('a'), li('b'))))
  assert.equal(r.changed, false)
  assert.deepEqual(findJoinPoints(r.doc), [])
})

test('幂等:合并后再合并不再有改动', () => {
  const tr = mk(ol(li('a')), ol(li('b'))).tr
  mergeAdjacentLists(tr)
  const tr2 = EditorState.create({ schema, doc: tr.doc }).tr
  assert.equal(mergeAdjacentLists(tr2), false)
})
