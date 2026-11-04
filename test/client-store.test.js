import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoardStore } from '../src/host/store.js'
import { createService } from '../src/host/index.js'
import { createStore } from '../src/client/store.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const store = new BoardStore(await mkdtemp(join(tmpdir(), 'wb-')))
  const service = createService(store)
  const transport = { open: (id) => service.open({ id }), apply: (id, baseRev, ops) => service.apply({ id, baseRev, ops }) }
  const errors = []
  const ui = createStore({ transport, onError: (e) => errors.push(e) })
  const { board } = await service.create({ title: 't' })
  await ui.load(board.id)
  return { service, ui, errors, id: board.id }
}
const settle = async (ui) => { for (let i = 0; i < 50 && ui.getState().saving > 0; i++) await sleep(5) }

test('client store: 乐观更新立刻可见,随后落盘', async () => {
  const { ui, service, id } = await setup()
  ui.dispatch([{ op: 'addNode', node: { id: 'a', type: 'text', x: 1, y: 2, text: 'x' } }])
  assert.equal(ui.getState().board.nodes.length, 1) // 立刻可见
  await settle(ui)
  assert.equal((await service.open({ id })).board.nodes.length, 1)
  assert.equal(ui.getState().rev, (await service.open({ id })).rev)
})

test('client store: 撤销/重做 同样落盘;新操作清空重做栈', async () => {
  const { ui, service, id } = await setup()
  ui.dispatch([{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } }])
  ui.dispatch([{ op: 'updateNode', id: 'a', patch: { title: '标题' } }])
  ui.dispatch([{ op: 'moveNodes', ids: ['a'], dx: 10, dy: 10 }])
  ui.undo(); ui.undo()
  await settle(ui)
  let n = (await service.open({ id })).board.nodes[0]
  assert.deepEqual([n.x, n.y, n.title], [0, 0, undefined])
  ui.redo()
  await settle(ui)
  n = (await service.open({ id })).board.nodes[0]
  assert.equal(n.title, '标题')
  ui.dispatch([{ op: 'setTitle', title: '新' }])
  assert.equal(ui.getState().canRedo, false)
})

test('client store: 删除节点可撤销,连线一并恢复', async () => {
  const { ui } = await setup()
  ui.dispatch([
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'b', type: 'text', x: 500, y: 0 } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'b', label: 'L' } },
  ])
  ui.dispatch([{ op: 'removeNodes', ids: ['a'] }])
  assert.equal(ui.getState().board.edges.length, 0)
  ui.undo()
  const b = ui.getState().board
  assert.equal(b.nodes.length, 2)
  assert.equal(b.edges[0].label, 'L')
})

test('client store: merge 键把连续拖动合并为一步撤销', async () => {
  const { ui } = await setup()
  ui.dispatch([{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } }])
  for (let i = 0; i < 5; i++) ui.dispatch([{ op: 'moveNodes', ids: ['a'], dx: 2, dy: 0 }], { merge: 'drag1' })
  assert.equal(ui.getState().board.nodes[0].x, 10)
  ui.undo()
  assert.equal(ui.getState().board.nodes[0].x, 0)
})

test('client store: 外部(agent)改动 → externalChange 后可见,且不误吞自己的回声', async () => {
  const { ui, service, id } = await setup()
  await service.apply({ id, ops: [{ op: 'addNode', node: { id: 'ag', type: 'text', x: 0, y: 0, text: 'from agent' } }] })
  assert.equal(ui.getState().board.nodes.length, 0)
  await ui.externalChange(id, undefined)
  assert.equal(ui.getState().board.nodes[0].id, 'ag')
  // 自己写入的回声:rev 相同 → 不重复加载
  ui.dispatch([{ op: 'addNode', node: { id: 'me', type: 'text', x: 0, y: 0 } }])
  await settle(ui)
  const before = ui.getState().board
  await ui.externalChange(id, ui.getState().rev)
  assert.equal(ui.getState().board, before)
})

test('client store: stale 冲突 → 以磁盘为准重新加载并报错', async () => {
  const { ui, service, id, errors } = await setup()
  // agent 抢先写入,UI 的 rev 变旧
  await service.apply({ id, ops: [{ op: 'addNode', node: { id: 'ag', type: 'text', x: 0, y: 0 } }] })
  ui.dispatch([{ op: 'addNode', node: { id: 'me', type: 'text', x: 100, y: 0 } }])
  await settle(ui)
  await sleep(30)
  assert.equal(errors.length, 1)
  assert.deepEqual(ui.getState().board.nodes.map((n) => n.id), ['ag'])
})
