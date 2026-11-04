import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoardStore } from '../src/host/store.js'
import { createService } from '../src/host/index.js'

// 用假的 ctx 验证 agent 工具与 UI 走同一个 service,且结果一致
test('service: 工具路径与 UI 路径共用,agent 的改动对 UI 可见', async () => {
  const store = new BoardStore(await mkdtemp(join(tmpdir(), 'wb-')))
  const events = []
  const service = createService(store, (...a) => events.push(a))

  const { board } = await service.create({ title: 'demo' })
  // "agent" 写入
  const r = await service.apply({ id: board.id, ops: [
    { op: 'addNode', node: { id: 'a', type: 'text', title: '想法', text: '# 内容', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'b', type: 'text', place: { rightOf: 'a' } } },
    { op: 'addEdge', edge: { fromNode: 'a', toNode: 'b', label: '导致' } },
  ] })
  // "UI" 读取
  const opened = await service.open({ id: board.id })
  assert.equal(opened.board.nodes.length, 2)
  assert.equal(opened.rev, r.rev)
  assert.equal(opened.board.edges[0].label, '导致')
  // agent 读到的摘要
  const sum = await service.read({ id: board.id })
  assert.equal(sum.nodes[0].title, '想法')
  assert.equal(sum.rev, r.rev)
  assert.deepEqual(events.map((e) => e[0]), ['applied'])
})
