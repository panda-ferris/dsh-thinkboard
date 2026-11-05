import test from 'node:test'
import assert from 'node:assert/strict'
import { createFocusBus } from '../src/client/focusbus.js'

test('focusbus: 请求先存起来,take 取走即清空', () => {
  const bus = createFocusBus()
  assert.equal(bus.take(), null)
  bus.request('b1', 'n1')
  assert.deepEqual({ ...bus.peek(), at: 0 }, { boardId: 'b1', nodeId: 'n1', at: 0 })
  const p = bus.take(); assert.equal(p.boardId, 'b1'); assert.equal(p.nodeId, 'n1')
  assert.equal(bus.take(), null); assert.equal(bus.peek(), null)
})

test('focusbus: 订阅者在请求时被通知;取消订阅后不再通知', () => {
  const bus = createFocusBus(); let n = 0
  const off = bus.subscribe(() => { n++ })
  bus.request('b', 'x'); assert.equal(n, 1)
  off(); bus.request('b', 'y'); assert.equal(n, 1)
})

test('focusbus: 没有订阅者时请求不丢(面板稍后挂载再取)', () => {
  const bus = createFocusBus(); bus.request('b1', 'n9')
  assert.equal(bus.take().nodeId, 'n9')
})

test('focusbus: 后一个请求覆盖前一个(只关心最近一次点击)', () => {
  const bus = createFocusBus(); bus.request('b1', 'a'); bus.request('b2', 'b')
  const p = bus.take(); assert.deepEqual([p.boardId, p.nodeId], ['b2', 'b'])
})

test('focusbus: 过期请求被丢弃,避免很久以后挂载面板时突然跳走', async () => {
  const bus = createFocusBus(); bus.request('b1', 'n1')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(bus.take(10), null)
  bus.request('b1', 'n1'); assert.ok(bus.take(10_000))
})
