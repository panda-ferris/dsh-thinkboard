import test from 'node:test'
import assert from 'node:assert/strict'
import { labelOf, encodeRef, parseRef, chipFor, serializeRef, chipsForSelection, SCHEME, SOURCE } from '../src/client/chatref.js'

const board = { id: 'b1', title: '产品规划', nodes: [
  { id: 'n1', type: 'text', title: '登录方案', text: '用 OAuth\n第二行' },
  { id: 'n2', type: 'text', text: '# 无标题卡片\n正文' },
  { id: 'n3', type: 'shape', kind: 'diamond', text: '已登录?' },
  { id: 'n4', type: 'group', label: '第一阶段' },
  { id: 'n5', type: 'image', file: 'assets/x.png', caption: '架构图' },
  { id: 'n6', type: 'text', text: 'x'.repeat(2000), title: '很长' },
  { id: 'n7', type: 'text' },
] }
const node = (id) => board.nodes.find((n) => n.id === id)

test('labelOf: 标题 > 框标题 > 图形文字 > 正文首行(去掉 #)> 图片说明 > 类型名', () => {
  assert.equal(labelOf(node('n1')), '登录方案')
  assert.equal(labelOf(node('n2')), '无标题卡片')
  assert.equal(labelOf(node('n3')), '已登录?')
  assert.equal(labelOf(node('n4')), '第一阶段')
  assert.equal(labelOf(node('n5')), '架构图')
  assert.equal(labelOf(node('n7')), '卡片')
  assert.equal(labelOf({ type: 'image' }), '图片')
})

test('labelOf: 过长截断到 40 字并加省略号;空白折叠', () => {
  const l = labelOf({ type: 'text', title: 'a'.repeat(100) })
  assert.equal([...l].length, 40); assert.ok(l.endsWith('…'))
  assert.equal(labelOf({ type: 'text', title: '  多   个\n空白 ' }), '多 个 空白')
})

test('encodeRef / parseRef 往返;标签里的括号与换行被清理,不破坏格式', () => {
  const ref = encodeRef('b1', 'n1', '登录[方案](v2)\n换行')
  assert.ok(ref.startsWith('@[') && ref.endsWith(`(${SCHEME}:b1/n1)`))
  assert.deepEqual(parseRef(ref), { label: '登录 方案 v2 换行', boardId: 'b1', nodeId: 'n1' })
  assert.equal((ref.match(/\]/g) || []).length, 1)
})

test('encodeRef:非法 id 抛错(防止夹带内容)', () => {
  for (const bad of ['../x', 'a b', '', 'a/b', 'a)', 'x'.repeat(65)]) {
    assert.throws(() => encodeRef(bad, 'n1', 'l'), /invalid/); assert.throws(() => encodeRef('b1', bad, 'l'), /invalid/)
  }
})

test('parseRef:不合法一律返回 null', () => {
  for (const bad of [null, undefined, 5, '', '@[x](dsh-session:b1/n1)', '@[x](dsh-thinkboard:b1)', '@[x](dsh-thinkboard:b1/n1/extra)', '@[x](dsh-thinkboard:b 1/n1)', '[x](dsh-thinkboard:b1/n1)', '@[x](dsh-thinkboard:b1/n1) 尾巴']) assert.equal(parseRef(bad), null, String(bad))
})

test('chipFor:来源 thinkboard、外观借用会话图标、clipboardText 与 ref 一致', () => {
  const c = chipFor('b1', node('n1'))
  assert.equal(c.source, SOURCE); assert.equal(c.appearance, 'session'); assert.equal(c.label, '登录方案'); assert.equal(c.clipboardText, c.ref)
  assert.deepEqual(parseRef(c.ref), { label: '登录方案', boardId: 'b1', nodeId: 'n1' })
})

test('serializeRef:带上类型、id、标题与正文,agent 能直接据此用工具改', () => {
  const t = serializeRef(chipFor('b1', node('n1')).ref, board)
  assert.match(t, /产品规划/); assert.match(t, /\[n1\]/); assert.match(t, /卡片/); assert.match(t, /标题「登录方案」/); assert.match(t, /OAuth/)
})

test('serializeRef:发送时读取的是"当前"内容,而不是引用时的快照', () => {
  const ref = chipFor('b1', node('n1')).ref
  const edited = { ...board, nodes: board.nodes.map((n) => (n.id === 'n1' ? { ...n, text: '改成了 SAML' } : n)) }
  assert.match(serializeRef(ref, edited), /SAML/); assert.doesNotMatch(serializeRef(ref, edited), /OAuth/)
})

test('serializeRef:过长正文被截断并提示用 thinkboard_read 读取全文', () => {
  const t = serializeRef(chipFor('b1', node('n6')).ref, board)
  assert.ok(t.length < 900); assert.match(t, /已截断/); assert.match(t, /thinkboard_read/)
})

test('serializeRef:图形带 kind;框用框标题;图片用说明', () => {
  assert.match(serializeRef(chipFor('b1', node('n3')).ref, board), /图形\/diamond/)
  assert.match(serializeRef(chipFor('b1', node('n4')).ref, board), /框.*标题「第一阶段」/)
  assert.match(serializeRef(chipFor('b1', node('n5')).ref, board), /图片[\s\S]*架构图/)
})

test('serializeRef:元素已删除 / 白板读不到 / ref 非法 都不抛错,给出可读说明', () => {
  const ref = chipFor('b1', node('n1')).ref
  assert.match(serializeRef(ref, { ...board, nodes: [] }), /已不存在/)
  assert.match(serializeRef(ref, null), /读不到/)
  assert.match(serializeRef(ref, { ...board, id: 'other' }), /读不到/)
  assert.equal(serializeRef('乱七八糟', board), '乱七八糟')
})

test('chipsForSelection:按白板顺序产出,只含存在的元素', () => {
  const cs = chipsForSelection(board, ['n3', 'n1', 'ghost'])
  assert.deepEqual(cs.map((c) => parseRef(c.ref).nodeId), ['n1', 'n3'])
  assert.deepEqual(chipsForSelection(board, []), [])
})
