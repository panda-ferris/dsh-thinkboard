import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoardStore } from '../src/host/store.js'
import { createService } from '../src/host/index.js'
import { registerTools } from '../src/host/tools.js'

async function tools() {
  const service = createService(new BoardStore(await mkdtemp(join(tmpdir(), 'wb-'))))
  const reg = new Map()
  const ctx = { effect: (fn) => fn(), tools: { register: (t) => { reg.set(t.name, t); return () => reg.delete(t.name) } } }
  registerTools(ctx, service)
  return reg
}

test('tools: 注册两个工具,schema 为合法 JSON Schema 对象', async () => {
  const reg = await tools()
  assert.deepEqual([...reg.keys()].sort(), ['thinkboard_edit', 'thinkboard_read'])
  for (const t of reg.values()) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(typeof t.execute, 'function')
    assert.equal(t.output.schema.type, 'object')
    assert.ok(t.description.length > 50)
  }
})

test('tools: agent 创建→编辑→读取 全流程,结果与 UI 读取一致', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create', title: 'AI 整理' })).result)
  const r = JSON.parse((await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 'a', type: 'text', title: '要点', text: '- x' } },
    { op: 'addNode', node: { id: 'b', type: 'text', text: 'next', place: { rightOf: 'a' } } },
    { op: 'addNode', node: { id: 'g', type: 'group', label: '分组', color: 'blue', x: -20, y: -60, width: 800, height: 300 } },
    { op: 'addEdge', edge: { fromNode: 'a', toNode: 'b', label: '然后' } },
  ] })).result)
  assert.ok(r.rev >= 2)
  const got = JSON.parse((await read.execute({ board })).result)
  assert.equal(got.nodes.length, 3)
  assert.equal(got.edges[0].label, '然后')
  assert.equal(got.nodes.find((n) => n.id === 'b').x, 360) // 320 宽 + 40 间距
  const list = JSON.parse((await read.execute({})).result)
  assert.equal(list[0].title, 'AI 整理')
})

test('tools: 非法参数/非法操作返回可读错误且不改动白板', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await assert.rejects(edit.execute({ board, ops: 'nope' }), /must be a array/)
  await assert.rejects(edit.execute({ board, ops: [{ op: 'removeNodes', ids: ['zzz'] }] }), /not found/)
  await assert.rejects(edit.execute({ board, bogus: 1, ops: [] }), /unknown argument/)
  assert.equal(JSON.parse((await read.execute({ board })).result).nodes.length, 0)
})

test('tools: agent 用 arrange 排版(对齐/分布/适配/成框),与 UI 共用同一内核', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 } },
    { op: 'addNode', node: { id: 'b', type: 'text', x: 130, y: 70, width: 100, height: 50 } },
    { op: 'addNode', node: { id: 'c', type: 'text', x: 400, y: 20, width: 100, height: 50 } },
  ] })
  await edit.execute({ action: 'arrange', board, kind: 'align', ids: ['a', 'b', 'c'], mode: 'top' })
  let g = JSON.parse((await read.execute({ board })).result)
  assert.deepEqual(g.nodes.map((n) => n.y), [0, 0, 0])
  await edit.execute({ action: 'arrange', board, kind: 'distribute', ids: ['a', 'b', 'c'], axis: 'x' })
  g = JSON.parse((await read.execute({ board })).result)
  assert.equal(g.nodes.find((n) => n.id === 'b').x, 200) // 两端 0..500,三块共 300,间隙各 100
  const w = JSON.parse((await edit.execute({ action: 'arrange', board, kind: 'wrap', ids: ['a', 'b'] })).result)
  assert.equal(w.changed, true)
  g = JSON.parse((await read.execute({ board })).result)
  assert.equal(g.nodes.filter((n) => n.type === 'group').length, 1)
  const again = JSON.parse((await edit.execute({ action: 'arrange', board, kind: 'align', ids: ['a', 'b'], mode: 'top' })).result)
  assert.equal(again.changed, false) // 已对齐 → 不产生写盘
  await assert.rejects(edit.execute({ action: 'arrange', board, kind: 'spiral' }), /unknown arrange kind/)
})

test('tools: thinkboard_read 的 query 只返回命中的元素', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, title: 'Redis 缓存', text: '热点数据' } },
    { op: 'addNode', node: { id: 'b', type: 'text', x: 400, y: 0, title: '部署', text: '无关内容' } },
    { op: 'addNode', node: { id: 'c', type: 'text', x: 800, y: 0, text: '先部署 redis' } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'c', label: '依赖 redis' } },
  ] })
  const r = JSON.parse((await read.execute({ board, query: 'REDIS' })).result)
  assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['a', 'c'])
  assert.equal(r.matches[0].id, 'a')
  assert.deepEqual(r.edges.map((e) => e.id), ['e'])
  const none = JSON.parse((await read.execute({ board, query: '不存在' })).result)
  assert.deepEqual([none.nodes.length, none.matches.length], [0, 0])
  assert.equal(JSON.parse((await read.execute({ board })).result).nodes.length, 3) // 不带 query 仍是全量
})

test('tools: arrange collapse/expand 折叠长文本卡片,只作用于文字卡片', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, height: 600, text: 'long' } },
    { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, height: 600 } },
  ] })
  await edit.execute({ action: 'arrange', board, kind: 'collapse', ids: ['a', 'g'] })
  let g = JSON.parse((await read.execute({ board })).result)
  assert.equal(g.nodes.find((n) => n.id === 'a').height, 112)
  assert.equal(g.nodes.find((n) => n.id === 'g').height, 600)
  const again = JSON.parse((await edit.execute({ action: 'arrange', board, kind: 'collapse', ids: ['a'] })).result)
  assert.equal(again.changed, false)
  await edit.execute({ action: 'arrange', board, kind: 'expand', ids: ['a'] })
  g = JSON.parse((await read.execute({ board })).result)
  assert.equal(g.nodes.find((n) => n.id === 'a').height, 600)
})

test('tools: agent 画流程图(图形 + 折线 + 端点),非法参数得到明确报错', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create', title: '登录流程' })).result)
  await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 's', type: 'shape', kind: 'terminator', text: '开始', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'c', type: 'shape', kind: 'diamond', text: '已登录?', place: { below: 's', gap: 60 } } },
    { op: 'addNode', node: { id: 'y', type: 'shape', kind: 'rect', text: '进入首页', fill: 'green', place: { rightOf: 'c', gap: 80 } } },
    { op: 'addNode', node: { id: 'n', type: 'shape', kind: 'parallelogram', text: '输入账号密码', place: { below: 'c', gap: 60 } } },
    { op: 'addEdge', edge: { fromNode: 's', toNode: 'c', fromSide: 'bottom', toSide: 'top', route: 'orthogonal' } },
    { op: 'addEdge', edge: { fromNode: 'c', toNode: 'y', fromSide: 'right', toSide: 'left', route: 'orthogonal', label: '是', endEnd: 'arrow' } },
    { op: 'addEdge', edge: { fromNode: 'c', toNode: 'n', fromSide: 'bottom', toSide: 'top', route: 'orthogonal', label: '否' } },
  ] })
  const g = JSON.parse((await read.execute({ board, full: true })).result)
  assert.equal(g.nodes.length, 4)
  assert.deepEqual(g.nodes.map((n) => n.kind ?? n.type), g.nodes.map((n) => n.kind ?? n.type))
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]))
  assert.equal(byId.c.width, 160); assert.equal(byId.c.height, 100)         // 菱形默认尺寸
  assert.ok(byId.c.y > byId.s.y + byId.s.height)                            // 在开始之下
  assert.ok(byId.y.x > byId.c.x + byId.c.width)                             // 在判断右侧
  assert.deepEqual(g.edges.map((e) => e.route), ['orthogonal', 'orthogonal', 'orthogonal'])
  await assert.rejects(edit.execute({ board, ops: [{ op: 'addNode', node: { type: 'shape', kind: 'hexagram', x: 0, y: 0 } }] }), /shape\.kind/)
  await assert.rejects(edit.execute({ board, ops: [{ op: 'addEdge', edge: { fromNode: 's', toNode: 'c', route: 'zigzag' } }] }), /route/)
  // 失败的批次整体回滚
  assert.equal(JSON.parse((await read.execute({ board })).result).nodes.length, 4)
})

test('tools: 连线 bend 可设置/清除,非法值被拒绝', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await edit.execute({ board, ops: [
    { op: 'addNode', node: { id: 'a', type: 'shape', kind: 'rect', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'b', type: 'shape', kind: 'rect', x: 0, y: 300 } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'right', route: 'orthogonal', bend: 80 } },
  ] })
  assert.equal(JSON.parse((await read.execute({ board })).result).edges[0].bend, 80)
  await edit.execute({ board, ops: [{ op: 'updateEdge', id: 'e', patch: { bend: null } }] })
  assert.ok(!('bend' in JSON.parse((await read.execute({ board })).result).edges[0]))
  await assert.rejects(edit.execute({ board, ops: [{ op: 'updateEdge', id: 'e', patch: { bend: 'far' } }] }), /bend/)
  await assert.rejects(edit.execute({ board, ops: [{ op: 'updateEdge', id: 'e', patch: { bend: 99999 } }] }), /bend/)
})

test('tools: arrange group / ungroup,read 带出 cluster', async () => {
  const reg = await tools()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const { board } = JSON.parse((await edit.execute({ action: 'create' })).result)
  await edit.execute({ board, ops: ['a', 'b', 'c'].map((id, i) => ({ op: 'addNode', node: { id, type: 'shape', kind: 'rect', x: i * 200, y: 0 } })) })
  const r = JSON.parse((await edit.execute({ action: 'arrange', board, kind: 'group', ids: ['a', 'b'] })).result)
  assert.equal(r.changed, true)
  let g = JSON.parse((await read.execute({ board })).result)
  const ca = g.nodes.find((n) => n.id === 'a').cluster
  assert.ok(ca && ca === g.nodes.find((n) => n.id === 'b').cluster && !g.nodes.find((n) => n.id === 'c').cluster)
  assert.equal(JSON.parse((await edit.execute({ action: 'arrange', board, kind: 'group', ids: ['a', 'b'] })).result).changed, false) // 已是同一组合
  await edit.execute({ action: 'arrange', board, kind: 'ungroup', ids: ['a'] })
  g = JSON.parse((await read.execute({ board })).result)
  assert.ok(g.nodes.every((n) => !n.cluster))
})
