import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard } from '../src/core/model.js'
import { applyOps } from '../src/core/ops.js'
import { alignOps, distributeOps, fitGroupOps, wrapInGroupOps, copyPayload, parsePayload, pasteOps, topLevel } from '../src/core/arrange.js'

const T = (id, x, y, w = 100, h = 60) => ({ op: 'addNode', node: { id, type: 'text', x, y, width: w, height: h } })
const make = (...ops) => applyOps(createBoard({ id: 'b' }), ops).board
const run = (b, ops) => applyOps(b, ops).board
const at = (b, id) => b.nodes.find((n) => n.id === id)

test('align: left / right / hcenter', () => {
  const b = make(T('a', 0, 0, 100), T('b', 50, 100, 200), T('c', 300, 200, 50))
  let r = run(b, alignOps(b, ['a', 'b', 'c'], 'left'))
  assert.deepEqual(['a', 'b', 'c'].map((i) => at(r, i).x), [0, 0, 0])
  r = run(b, alignOps(b, ['a', 'b', 'c'], 'right'))
  assert.deepEqual(['a', 'b', 'c'].map((i) => at(r, i).x + at(r, i).width), [350, 350, 350])
  r = run(b, alignOps(b, ['a', 'b', 'c'], 'hcenter'))
  assert.deepEqual(new Set(['a', 'b', 'c'].map((i) => at(r, i).x + at(r, i).width / 2)).size, 1)
})

test('align: top / bottom / vcenter 且已对齐的不产生多余操作', () => {
  const b = make(T('a', 0, 0, 100, 60), T('b', 200, 40, 100, 100))
  assert.equal(run(b, alignOps(b, ['a', 'b'], 'top')).nodes.find((n) => n.id === 'b').y, 0)
  assert.equal(at(run(b, alignOps(b, ['a', 'b'], 'bottom')), 'a').y + 60, 140)
  const c = run(b, alignOps(b, ['a', 'b'], 'vcenter'))
  assert.equal(at(c, 'a').y + 30, at(c, 'b').y + 50)
  assert.equal(alignOps(run(b, alignOps(b, ['a', 'b'], 'top')), ['a', 'b'], 'top').length, 0)
})

test('align: 少于 2 个或模式非法 → 不动', () => {
  const b = make(T('a', 0, 0), T('b', 50, 50))
  assert.deepEqual(alignOps(b, ['a'], 'left'), [])
  assert.deepEqual(alignOps(b, ['a', 'b'], 'diagonal'), [])
})

test('distribute: 水平等间距,两端不动,不依赖选择顺序', () => {
  const b = make(T('a', 0, 0, 100), T('b', 130, 0, 50), T('c', 400, 0, 100), T('d', 210, 0, 80))
  const r = run(b, distributeOps(b, ['d', 'c', 'a', 'b'], 'x'))
  const s = ['a', 'b', 'd', 'c'].map((i) => at(r, i)).sort((p, q) => p.x - q.x)
  const gaps = s.slice(1).map((n, i) => n.x - (s[i].x + s[i].width))
  assert.equal(at(r, 'a').x, 0); assert.equal(at(r, 'c').x, 400)
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) <= 1), JSON.stringify(gaps))
})

test('distribute: 垂直方向;少于 3 个不动', () => {
  const b = make(T('a', 0, 0, 50, 50), T('b', 0, 60, 50, 50), T('c', 0, 300, 50, 50))
  const r = run(b, distributeOps(b, ['a', 'b', 'c'], 'y'))
  // a:0..50  c:300..350  总高 350,三块共 150,剩 200,两个间隙各 100 → b 在 150
  assert.equal(at(r, 'b').y, 150)
  assert.deepEqual(distributeOps(b, ['a', 'b'], 'y'), [])
})

test('选中框 + 框内卡片:卡片只随框动一次,不会被对齐重复移动', () => {
  const b = make(
    { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300 } },
    T('in', 50, 50), T('out', 600, 0),
  )
  assert.deepEqual(topLevel(b, ['g', 'in', 'out']).map((n) => n.id).sort(), ['g', 'out'])
  const r = run(b, alignOps(b, ['g', 'in', 'out'], 'bottom'))
  assert.equal(at(r, 'in').y - at(r, 'g').y, 50) // 相对位置不变
})

test('fitGroup: 贴合框内卡片;空框/已合适则不动', () => {
  const b = make(
    { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 1000, height: 800 } },
    T('a', 100, 100, 100, 60), T('b', 300, 200, 100, 60),
  )
  const r = run(b, fitGroupOps(b, 'g', { padding: 20, titleHeight: 40 }))
  assert.deepEqual([at(r, 'g').x, at(r, 'g').y, at(r, 'g').width, at(r, 'g').height], [80, 40, 340, 240])
  assert.deepEqual(fitGroupOps(r, 'g', { padding: 20, titleHeight: 40 }), [])
  const empty = make({ op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100 } })
  assert.deepEqual(fitGroupOps(empty, 'g'), [])
})

test('wrapInGroup: 新框恰好包住选中卡片,并因此"包含"它们', () => {
  const b = make(T('a', 100, 100), T('b', 300, 200))
  const r = run(b, wrapInGroupOps(b, ['a', 'b'], 'G'))
  const g = at(r, 'G')
  for (const id of ['a', 'b']) {
    const n = at(r, id)
    assert.ok(n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height)
  }
  const moved = run(r, [{ op: 'moveNodes', ids: ['G'], dx: 10, dy: 10 }])
  assert.equal(at(moved, 'a').x, 110)
})

test('copy/paste: 往返保留连线;新 id 不冲突;框带走框内卡片', () => {
  const b = make(
    { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300 } },
    T('a', 50, 50), T('b', 200, 50), T('x', 800, 0),
    { op: 'addEdge', edge: { id: 'e1', fromNode: 'a', toNode: 'b', label: '关系' } },
    { op: 'addEdge', edge: { id: 'e2', fromNode: 'b', toNode: 'x' } },
  )
  const text = copyPayload(b, ['g'])
  const p = parsePayload(text)
  assert.equal(p.nodes.length, 3) // g + a + b
  assert.equal(p.edges.length, 1) // 只有两端都在复制范围内的连线
  let n = 0
  const { ops, ids } = pasteOps(p, { boardId: 'b', newId: (pre) => pre + 'new' + n++ })
  const r = run(b, ops)
  assert.equal(r.nodes.length, 7)
  assert.equal(ids.length, 3)
  assert.equal(r.edges.find((e) => e.label === '关系' && e.id !== 'e1').fromNode.startsWith('nnew'), true)
  assert.equal(at(r, ids[0]).x, 32) // 默认偏移
})

test('paste: 指定中心点;跨白板丢弃图片卡片及其连线;非法内容返回 null', () => {
  const b = make(T('a', 0, 0, 100, 100), { op: 'addNode', node: { id: 'i', type: 'image', file: 'assets/x.png', x: 200, y: 0, width: 100, height: 100 } }, { op: 'addEdge', edge: { fromNode: 'a', toNode: 'i' } })
  const p = parsePayload(copyPayload(b, ['a', 'i']))
  const same = pasteOps(p, { boardId: 'b', at: { x: 1000, y: 1000 }, newId: (x) => x + Math.random() })
  assert.equal(same.ids.length, 2)
  const cross = pasteOps(p, { boardId: 'OTHER', newId: (x) => x + Math.random() })
  assert.equal(cross.ids.length, 1)
  assert.equal(cross.ops.filter((o) => o.op === 'addEdge').length, 0)
  assert.equal(parsePayload('hello'), null)
  assert.equal(parsePayload('dsh-thinkboard/v1:{bad'), null)
})

import { dropTarget, memberCount } from '../src/core/arrange.js'

const GB = () => make(
  { op: 'addNode', node: { id: 'g1', type: 'group', x: 0, y: 0, width: 400, height: 300 } },
  { op: 'addNode', node: { id: 'g2', type: 'group', x: 50, y: 50, width: 150, height: 120 } }, // 小框叠在 g1 里
  T('c', 600, 100, 100, 60), T('d', 600, 200, 100, 60), T('in', 300, 200, 60, 40),
)

test('dropTarget: 中心点落入框内才算(框内的不同位置)', () => {
  const b = GB()
  assert.equal(dropTarget(b, ['c'], -400, 0).target, 'g1')       // 中心 (250,130) 在 g1 内、不在 g2(50..200)
  assert.equal(dropTarget(b, ['c'], -290, 0).target, 'g1')       // 中心 (360,130)
})

test('dropTarget: 边界值——中心刚好在框边上算在内,差 1px 不算', () => {
  const b = make({ op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300 } }, T('c', 600, 100, 100, 60))
  assert.equal(dropTarget(b, ['c'], -250, 0).target, 'g')   // 中心 x=400
  assert.equal(dropTarget(b, ['c'], -249, 0).target, null)  // 中心 x=401
})

test('dropTarget: 嵌套重叠时取面积最小的框', () => {
  const b = GB()
  assert.equal(dropTarget(b, ['c'], -475, 0).target, 'g2')  // 中心 (125,130) 同时在 g1、g2 内 → 小的 g2
})

test('dropTarget: 多个节点必须都落在同一个框才有目标', () => {
  const b = GB()
  assert.equal(dropTarget(b, ['c', 'd'], -400, 0).target, 'g1')
  assert.equal(dropTarget(b, ['c', 'd'], -400, 150).target, null) // d 掉到框外
  assert.deepEqual(dropTarget(b, ['c', 'd'], -400, 0).inside.sort(), ['c', 'd'])
})

test('dropTarget: 被移动的框自己不能当目标;只移动框时没有目标', () => {
  const b = GB()
  assert.equal(dropTarget(b, ['g2'], 10, 10).target, null)
  assert.equal(dropTarget(b, ['g1', 'c'], -400, 0).target, null) // g1 自己被移动,c 也不会落入它
})

test('dropTarget: 离开——原本在框内的卡片被拖出会列入 leaving', () => {
  const b = GB()
  const r = dropTarget(b, ['in'], 400, 0)
  assert.equal(r.target, null)
  assert.deepEqual(r.leaving, [{ nodeId: 'in', groupId: 'g1' }])
  assert.deepEqual(dropTarget(b, ['in'], 5, 5).leaving, []) // 仍在框内
})

test('dropTarget: 从一个框直接拖进另一个框 = 离开旧框 + 进入新框', () => {
  const b = make(
    { op: 'addNode', node: { id: 'A', type: 'group', x: 0, y: 0, width: 300, height: 300 } },
    { op: 'addNode', node: { id: 'B', type: 'group', x: 500, y: 0, width: 300, height: 300 } },
    T('x', 100, 100, 60, 40),
  )
  const r = dropTarget(b, ['x'], 450, 0)
  assert.equal(r.target, 'B'); assert.deepEqual(r.leaving, [{ nodeId: 'x', groupId: 'A' }])
})

test('memberCount: 只数卡片/图形,不数框', () => {
  const b = GB()
  assert.equal(memberCount(b, b.nodes.find((n) => n.id === 'g1')), 1) // 只有 in 的中心在 g1 内;g2 是框不数;c、d 在框外
  assert.equal(memberCount(b, b.nodes.find((n) => n.id === 'g2')), 0)
})
