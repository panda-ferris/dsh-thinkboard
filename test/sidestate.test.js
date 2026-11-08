import test from 'node:test'
import assert from 'node:assert/strict'
import { SIDE_DEFAULT, normalizeSide, sideFor, withSide, withoutSide, restorableDetail } from '../src/core/sidestate.js'

test('normalizeSide: 完整合法记录原样通过', () => {
  assert.deepEqual(normalizeSide({ open: false, tab: 'detail', detail: 'n1' }), { open: false, tab: 'detail', detail: 'n1' })
  assert.deepEqual(normalizeSide({ open: true, tab: 'chat', detail: null }), { open: true, tab: 'chat', detail: null })
})

test('normalizeSide: 缺字段/类型不对按默认;open 缺失时使用 fallbackOpen', () => {
  assert.deepEqual(normalizeSide({}), SIDE_DEFAULT); assert.deepEqual(normalizeSide(undefined), SIDE_DEFAULT)
  assert.equal(normalizeSide({}, false).open, false)
  for (const bad of [null, 5, 'x', [], true]) assert.deepEqual(normalizeSide(bad), SIDE_DEFAULT, JSON.stringify(bad))
  assert.equal(normalizeSide({ open: 'yes' }).open, true); assert.equal(normalizeSide({ open: 1 }, false).open, false)
})

test('normalizeSide: tab 为 detail 但没有有效卡片 id → 退回 chat 并清掉 detail', () => {
  for (const d of [undefined, null, '', 5, {}, 'x'.repeat(201)]) assert.deepEqual(normalizeSide({ open: true, tab: 'detail', detail: d }), { open: true, tab: 'chat', detail: null }, String(d))
})

test('normalizeSide: tab 为 chat 时不保留 detail;未知 tab 视为 chat', () => {
  assert.equal(normalizeSide({ tab: 'chat', detail: 'n1' }).detail, null)
  assert.deepEqual(normalizeSide({ tab: 'weird', detail: 'n1' }), { open: true, tab: 'chat', detail: null })
})

test('sideFor: 取该白板的记录;没有记录/表损坏/id 非法时用 fallbackOpen', () => {
  const map = { a: { open: false, tab: 'detail', detail: 'n1' }, b: { open: true, tab: 'chat', detail: null } }
  assert.deepEqual(sideFor(map, 'a'), { open: false, tab: 'detail', detail: 'n1' })
  assert.deepEqual(sideFor(map, 'b'), { open: true, tab: 'chat', detail: null })
  assert.deepEqual(sideFor(map, 'zz', false), { open: false, tab: 'chat', detail: null })
  for (const bad of [null, undefined, 5, 'x', []]) assert.deepEqual(sideFor(bad, 'a'), SIDE_DEFAULT)
  for (const id of [null, undefined, '', 5]) assert.deepEqual(sideFor(map, id), SIDE_DEFAULT)
})

test('sideFor: 原型链上的键(__proto__、constructor、toString)不会被当成白板记录', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.deepEqual(sideFor({}, id), SIDE_DEFAULT, id)
})

test('withSide: 不修改入参,返回新表;写入的记录被规整', () => {
  const map = { a: { open: true, tab: 'chat', detail: null } }
  const snap = JSON.stringify(map)
  const next = withSide(map, 'b', { open: false, tab: 'detail', detail: 'n9' })
  assert.equal(JSON.stringify(map), snap); assert.notEqual(next, map)
  assert.deepEqual(next.b, { open: false, tab: 'detail', detail: 'n9' }); assert.deepEqual(next.a, map.a)
  assert.deepEqual(withSide(map, 'c', { open: 'x', tab: 'detail' }).c, { open: true, tab: 'chat', detail: null })
})

test('withSide: 最近写入的排在最后;超过上限丢弃最早的', () => {
  let m = {}
  for (let i = 0; i < 205; i++) m = withSide(m, 'b' + i, { open: true, tab: 'chat', detail: null })
  const keys = Object.keys(m)
  assert.equal(keys.length, 200); assert.equal(keys[0], 'b5'); assert.equal(keys[199], 'b204')
  m = withSide(m, 'b5', { open: false, tab: 'chat', detail: null })
  assert.equal(Object.keys(m).at(-1), 'b5'); assert.equal(m.b5.open, false)
})

test('withSide: 非法白板 id、损坏的表不抛错', () => {
  assert.deepEqual(withSide({ a: 1 }, '', {}), { a: 1 }); assert.deepEqual(withSide(null, 'a', {}).a, SIDE_DEFAULT)
  assert.doesNotThrow(() => withSide('坏的', 'a', null))
})

test('withoutSide: 删除记录,不改入参;不存在时原样返回', () => {
  const m = { a: { open: true, tab: 'chat', detail: null }, b: { open: false, tab: 'chat', detail: null } }
  const n = withoutSide(m, 'a'); assert.deepEqual(Object.keys(n), ['b']); assert.deepEqual(Object.keys(m), ['a', 'b'])
  assert.equal(withoutSide(m, 'zz'), m); assert.deepEqual(withoutSide(null, 'a'), {})
})

test('restorableDetail: 卡片仍在且是文字卡片才恢复', () => {
  const nodes = [{ id: 'n1', type: 'text' }, { id: 'i1', type: 'image' }, { id: 'g1', type: 'group' }]
  assert.equal(restorableDetail({ tab: 'detail', detail: 'n1' }, nodes), 'n1')
  assert.equal(restorableDetail({ tab: 'detail', detail: 'gone' }, nodes), null)       // 卡片被删了
  assert.equal(restorableDetail({ tab: 'detail', detail: 'i1' }, nodes), null)         // 不是文字卡片
  assert.equal(restorableDetail({ tab: 'detail', detail: 'g1' }, nodes), null)
  assert.equal(restorableDetail({ tab: 'chat', detail: 'n1' }, nodes), null)           // 当时不在详情标签
})

test('restorableDetail: 缺参数/损坏输入不抛错,返回 null', () => {
  for (const [s, n] of [[null, []], [undefined, undefined], [{ tab: 'detail' }, []], [{ tab: 'detail', detail: 'n1' }, null], [{ tab: 'detail', detail: 'n1' }, [null, undefined, 5]]]) assert.equal(restorableDetail(s, n), null)
})
