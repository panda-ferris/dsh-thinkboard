import test from 'node:test'
import assert from 'node:assert/strict'
import { createReferenceSource, MAX_CANDIDATES } from '../src/client/refsource.js'
import { createFocusBus } from '../src/client/focusbus.js'
import { chipFor, parseRef } from '../src/client/chatref.js'

const board = { id: 'b1', title: '规划板', nodes: [
  { id: 'n1', type: 'text', title: '登录方案', text: '用 OAuth 登录' },
  { id: 'n2', type: 'shape', kind: 'rect', text: '支付' },
  { id: 'n3', type: 'text', text: 'SAML 备选' },
] }
const mk = (over = {}) => {
  const bus = createFocusBus()
  const src = createReferenceSource({ getBoard: () => board, openBoard: async () => board, focusBus: bus, t: (k) => k, ...over })
  return { src, bus }
}
const sig = new AbortController().signal

test('来源声明:@ 触发、名称 thinkboard、自带 codec', () => {
  const { src } = mk()
  assert.equal(src.trigger, '@'); assert.equal(src.name, 'thinkboard'); assert.equal(typeof src.codec.serialize, 'function'); assert.equal(typeof src.openReference, 'function')
})

test('候选:无查询时列出当前白板全部元素,带白板名与图标', async () => {
  const rows = await mk().src.candidates({}, { query: '', signal: sig })
  assert.deepEqual(rows.map((r) => r.name), ['登录方案', '支付', 'SAML 备选'])
  assert.ok(rows.every((r) => r.description === '规划板' && r.icon === 'session' && r.section === 'chatref.section'))
})

test('候选:按标题、正文、id 模糊匹配,不区分大小写', async () => {
  const { src } = mk()
  assert.deepEqual((await src.candidates({}, { query: '登录', signal: sig })).map((r) => r.name), ['登录方案'])
  assert.deepEqual((await src.candidates({}, { query: 'saml', signal: sig })).map((r) => r.name), ['SAML 备选'])
  assert.deepEqual((await src.candidates({}, { query: 'N2', signal: sig })).map((r) => r.name), ['支付'])
  assert.deepEqual(await src.candidates({}, { query: '没有这个', signal: sig }), [])
})

test('候选:引号查询(文件路径语法)、没有白板、已取消 → 空', async () => {
  assert.deepEqual(await mk().src.candidates({}, { query: 'x', quoted: true, signal: sig }), [])
  assert.deepEqual(await mk({ getBoard: () => null }).src.candidates({}, { query: '', signal: sig }), [])
  const ac = new AbortController(); ac.abort()
  assert.deepEqual(await mk().src.candidates({}, { query: '', signal: ac.signal }), [])
})

test(`候选:最多 ${MAX_CANDIDATES} 条`, async () => {
  const big = { id: 'b', title: 't', nodes: Array.from({ length: 100 }, (_, i) => ({ id: 'n' + i, type: 'text', title: 'k' + i })) }
  assert.equal((await mk({ getBoard: () => big }).src.candidates({}, { query: '', signal: sig })).length, MAX_CANDIDATES)
})

test('选择候选 → 插入对象(与按钮引用产出的完全一致)', async () => {
  const { src } = mk()
  const [row] = await src.candidates({}, { query: '登录', signal: sig })
  const out = src.onPick({ candidate: row })
  assert.deepEqual(out.insert, chipFor('b1', board.nodes[0]))
})

test('选择候选:元素已被删、白板已切换、候选值损坏 → 不插入,不抛错', async () => {
  const { src } = mk()
  const row = { value: JSON.stringify({ boardId: 'b1', nodeId: 'gone' }) }
  assert.equal(src.onPick({ candidate: row }), undefined)
  assert.equal(src.onPick({ candidate: { value: JSON.stringify({ boardId: 'other', nodeId: 'n1' }) } }), undefined)
  assert.equal(src.onPick({ candidate: { value: '{坏的' } }), undefined)
  assert.equal(mk({ getBoard: () => null }).src.onPick({ candidate: { value: JSON.stringify({ boardId: 'b1', nodeId: 'n1' }) } }), undefined)
})

test('点击对象:发出聚焦请求并返回 true;ref 不合法返回 false 且不发请求', () => {
  const { src, bus } = mk()
  assert.equal(src.openReference({}, { ref: chipFor('b1', board.nodes[1]).ref, appearance: 'session' }), true)
  const p = bus.take(); assert.deepEqual([p.boardId, p.nodeId], ['b1', 'n2'])
  assert.equal(src.openReference({}, { ref: '@[x](dsh-session:abc)' }), false)
  assert.equal(bus.peek(), null)
})

test('发送序列化:当前白板里的元素 → 带类型/id/标题/正文的文本', async () => {
  const t = await mk().src.codec.serialize(chipFor('b1', board.nodes[0]).ref)
  assert.match(t, /\[n1\]/); assert.match(t, /登录方案/); assert.match(t, /OAuth/)
})

test('发送序列化:引用的是另一块白板 → 去读那块白板;读失败也不抛错', async () => {
  const other = { id: 'b2', title: '别板', nodes: [{ id: 'x1', type: 'text', title: '外板卡片', text: '内容' }] }
  let opened = null
  const { src } = mk({ openBoard: async (id) => { opened = id; return other } })
  const ref = chipFor('b2', other.nodes[0]).ref
  assert.match(await src.codec.serialize(ref), /外板卡片/); assert.equal(opened, 'b2')
  const failing = mk({ openBoard: async () => { throw new Error('gone') } }).src
  assert.match(await failing.codec.serialize(ref), /读不到/)
})

test('发送序列化:非本来源的 ref 原样返回;clipboardText 原样', async () => {
  const { src } = mk()
  assert.equal(await src.codec.serialize('随便什么'), '随便什么')
  assert.equal(src.codec.clipboardText('@[a](dsh-thinkboard:b1/n1)'), '@[a](dsh-thinkboard:b1/n1)')
  assert.deepEqual(parseRef(chipFor('b1', board.nodes[0]).ref).nodeId, 'n1')
})
