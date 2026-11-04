import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyKeys } from '../src/client/storage.js'

const mem = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }
}

test('migrate: 旧键的值搬到新键,旧键被删除', () => {
  const s = mem({ 'dsh.whiteboard.last.v1': '"b1"', 'dsh.whiteboard.chat.v1': '{"open":true}', other: 'x' })
  assert.equal(migrateLegacyKeys(s), 2)
  assert.equal(s.getItem('dsh.thinkboard.last.v1'), '"b1"'); assert.equal(s.getItem('dsh.thinkboard.chat.v1'), '{"open":true}')
  assert.equal(s.getItem('dsh.whiteboard.last.v1'), null); assert.equal(s.getItem('other'), 'x')
})

test('migrate: 新键已存在则不覆盖(用户在新版本里的选择优先)', () => {
  const s = mem({ 'dsh.whiteboard.list.v1': '{"open":false}', 'dsh.thinkboard.list.v1': '{"open":true}' })
  assert.equal(migrateLegacyKeys(s), 0)
  assert.equal(s.getItem('dsh.thinkboard.list.v1'), '{"open":true}'); assert.equal(s.getItem('dsh.whiteboard.list.v1'), null)
})

test('migrate: 重复调用幂等;没有存储或抛错时不崩', () => {
  const s = mem({ 'dsh.whiteboard.a': '1' })
  assert.equal(migrateLegacyKeys(s), 1); assert.equal(migrateLegacyKeys(s), 0)
  assert.equal(migrateLegacyKeys(null), 0)
  assert.equal(migrateLegacyKeys({ get length() { throw new Error('denied') } }), 0)
})
