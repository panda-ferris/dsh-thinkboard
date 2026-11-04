import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard } from '../src/core/model.js'
import { applyOps } from '../src/core/ops.js'
import { clusterPath, membersOf, selectionUnitFor, enterScope, expandToUnits, unitsOf, groupOps, ungroupOps, scaleOps, remapClusters, validCluster, bounds } from '../src/core/cluster.js'

const N = (id, x, y, w = 100, h = 60, extra = {}) => ({ op: 'addNode', node: { id, type: 'shape', kind: 'rect', x, y, width: w, height: h, ...extra } })
const mk = (...ops) => applyOps(createBoard({ id: 'b' }), ops).board
const run = (b, ops) => applyOps(b, ops).board
const ids = (arr) => arr.map((n) => (typeof n === 'string' ? n : n.id)).sort()
const cl = (b, id) => b.nodes.find((n) => n.id === id).cluster

test('clusterPath:空/缺失 → [];多层按 / 拆分', () => {
  assert.deepEqual(clusterPath({}), []); assert.deepEqual(clusterPath({ cluster: '' }), [])
  assert.deepEqual(clusterPath({ cluster: 'a' }), ['a']); assert.deepEqual(clusterPath({ cluster: 'a/b/c' }), ['a', 'b', 'c'])
})

test('组合:至少两个单元;选中同一组合全部成员不重复组合', () => {
  const b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  assert.deepEqual(groupOps(b, ['a'], 'G'), [])
  const g = run(b, groupOps(b, ['a', 'b'], 'G'))
  assert.equal(cl(g, 'a'), 'G'); assert.equal(cl(g, 'b'), 'G'); assert.equal(cl(g, 'c'), undefined)
  assert.deepEqual(groupOps(g, ['a', 'b'], 'H'), []) // 同一组合的全部成员 = 1 个单元
})

test('组合:选中组合的一部分 + 另一个节点 → 整组 + 新节点 成一个新的外层组合(嵌套,内层保持)', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, groupOps(b, ['a', 'c'], 'H')) // 只选了 a(属于 G)和 c:a 会被补全成整个 G
  assert.equal(cl(b, 'a'), 'H/G'); assert.equal(cl(b, 'b'), 'H/G'); assert.equal(cl(b, 'c'), 'H')
  assert.deepEqual(ids(membersOf(b, ['H'])), ['a', 'b', 'c'])
  assert.deepEqual(ids(membersOf(b, ['H', 'G'])), ['a', 'b'])
})

test('取消组合:只解散最外层,内层保持;逐层解散最终回到无组合', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, groupOps(b, ['a', 'c'], 'H'))
  b = run(b, ungroupOps(b, ['a']))             // 解散 H
  assert.equal(cl(b, 'a'), 'G'); assert.equal(cl(b, 'b'), 'G'); assert.equal(cl(b, 'c'), undefined)
  b = run(b, ungroupOps(b, ['b']))             // 解散 G
  assert.ok(b.nodes.every((n) => !('cluster' in n)))
})

test('取消组合:选中的不是组合 → 没有操作;重复成员只处理一次', () => {
  const b = mk(N('a', 0, 0), N('b', 200, 0))
  assert.deepEqual(ungroupOps(b, ['a']), [])
  const g = run(b, groupOps(b, ['a', 'b'], 'G'))
  assert.equal(ungroupOps(g, ['a', 'b']).length, 2)
})

test('选择语义:点成员选整组;点非成员只选自己', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  assert.deepEqual(ids(selectionUnitFor(b, b.nodes[0])), ['a', 'b'])
  assert.deepEqual(ids(selectionUnitFor(b, b.nodes[2])), ['c'])
})

test('嵌套选择:最外层点击选最外层组合;进入后点击选内一层', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0), N('d', 600, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, groupOps(b, ['a', 'c'], 'H'))
  const a = b.nodes[0]
  assert.deepEqual(ids(selectionUnitFor(b, a)), ['a', 'b', 'c'])               // 最外层 H
  assert.deepEqual(enterScope(a), ['H'])
  assert.deepEqual(ids(selectionUnitFor(b, a, ['H'])), ['a', 'b'])             // 进入 H 后选 G
  assert.deepEqual(ids(selectionUnitFor(b, b.nodes[2], ['H'])), ['c'])         // H 里的 c 是单个
  assert.deepEqual(enterScope(a, ['H']), ['H', 'G'])
  assert.deepEqual(ids(selectionUnitFor(b, a, ['H', 'G'])), ['a'])             // 进入 G 后选单个
  assert.equal(enterScope(a, ['H', 'G']), null)                                // 已无更深一层
})

test('scope 失效(点了范围外的节点)→ 退回最外层语义', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0), N('d', 600, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, groupOps(b, ['c', 'd'], 'K'))
  assert.deepEqual(ids(selectionUnitFor(b, b.nodes[2], ['G'])), ['c', 'd'])
})

test('expandToUnits:选中组合的一个成员 → 补全整组', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  assert.deepEqual(ids(expandToUnits(b, ['a', 'c'])), ['a', 'b', 'c'])
})

test('unitsOf:组合是一个单元,外包盒是成员的并集;对齐按单元计算', () => {
  let b = mk(N('a', 0, 0, 100, 50), N('b', 300, 100, 100, 50), N('c', 700, 0, 100, 50))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  const u = unitsOf(b, ['a', 'b', 'c'])
  assert.equal(u.length, 2)
  const g = u.find((x) => x.key === 'G')
  assert.deepEqual(g.rect, { x: 0, y: 0, w: 400, h: 150 })
})

test('整体缩放:位置与尺寸按外包盒比例映射;缩回原比例可还原', () => {
  let b = mk(N('a', 100, 100, 100, 50), N('b', 300, 200, 100, 50))
  const from = bounds(b.nodes)                    // x100 y100 w300 h150
  const ops = scaleOps(b.nodes, from, { x: 100, y: 100, w: 600, h: 300 }) // 放大 2 倍
  const big = run(b, ops)
  const a = big.nodes[0], c = big.nodes[1]
  assert.deepEqual([a.x, a.y, a.width, a.height], [100, 100, 200, 100])
  assert.deepEqual([c.x, c.y, c.width, c.height], [500, 300, 200, 100])
  const back = run(big, scaleOps(big.nodes, bounds(big.nodes), from))
  assert.deepEqual(back.nodes.map((n) => [n.x, n.y, n.width, n.height]), b.nodes.map((n) => [n.x, n.y, n.width, n.height]))
})

test('整体缩放:最小尺寸;图片保持宽高比', () => {
  const b = mk(N('a', 0, 0, 100, 50), { op: 'addNode', node: { id: 'i', type: 'image', file: 'assets/x.png', x: 200, y: 0, width: 200, height: 100 } })
  const tiny = run(b, scaleOps(b.nodes, bounds(b.nodes), { x: 0, y: 0, w: 30, h: 15 }))
  assert.ok(tiny.nodes.every((n) => n.width >= 24 && n.height >= 24))
  const wide = run(b, scaleOps(b.nodes, bounds(b.nodes), { x: 0, y: 0, w: 800, h: 100 })) // 宽 ×2、高 ×~1.3(不同比例)
  const img = wide.nodes[1]
  assert.ok(Math.abs(img.width / img.height - 2) < 0.02, `${img.width}x${img.height}`)
})

test('复制:组合换新 id,副本不会并入原组合;结构(嵌套)保持', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, groupOps(b, ['a', 'c'], 'H'))
  let k = 0
  const copy = remapClusters(b.nodes, () => 'N' + k++)
  const pa = clusterPath(copy[0]), pc = clusterPath(copy[2])
  assert.equal(pa.length, 2); assert.equal(pc.length, 1)
  assert.equal(pa[0], pc[0])                                // 外层同一个新组合
  assert.ok(!['G', 'H'].includes(pa[0]) && !['G', 'H'].includes(pa[1]))
  assert.equal(clusterPath(copy[0])[1], clusterPath(copy[1])[1]) // a、b 仍同属内层新组合
  assert.deepEqual(clusterPath(b.nodes[0]), ['H', 'G'])     // 原数据未被改
})

test('复制:没有组合的节点原样返回', () => {
  const b = mk(N('a', 0, 0))
  assert.deepEqual(remapClusters(b.nodes, () => 'X'), b.nodes)
})

test('校验:cluster 字段格式(防注入/超深)', () => {
  assert.ok(validCluster('a') && validCluster('a/b-c_d') && validCluster('g1/g2/g3'))
  for (const bad of ['', '/a', 'a/', 'a//b', '../x', 'a b', 'a/' .repeat(9) + 'z', 5, null]) assert.ok(!validCluster(bad), String(bad))
})

// ---------- 内核与 agent ----------
test('ops:cluster 字段格式被校验', () => {
  assert.throws(() => mk(N('a', 0, 0, 100, 60, { cluster: '../x' })), /cluster/)
  assert.throws(() => mk(N('a', 0, 0, 100, 60, { cluster: 5 })), /cluster/)
  assert.doesNotThrow(() => mk(N('a', 0, 0, 100, 60, { cluster: 'g1/g2' })))
})

test('ops:删除成员后,只剩 1 个成员的组合自动解散;嵌套逐层处理', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, [{ op: 'removeNodes', ids: ['b'] }])
  assert.equal(cl(b, 'a'), undefined)                      // G 只剩 a → 解散
  let d = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  d = run(d, groupOps(d, ['a', 'b'], 'G'))
  d = run(d, groupOps(d, ['a', 'c'], 'H'))                 // H/G: a,b ; H: c
  d = run(d, [{ op: 'removeNodes', ids: ['c'] }])          // H 只剩 G 的成员(一个单元但 2 个节点)→ H 的成员数是 2,保留
  assert.equal(cl(d, 'a'), 'H/G')
  d = run(d, [{ op: 'removeNodes', ids: ['b'] }])          // 现在只剩 a:H、G 都解散
  assert.equal(cl(d, 'a'), undefined)
})

test('ops:删除整个组合的全部成员不会残留引用', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0), N('c', 400, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  b = run(b, [{ op: 'removeNodes', ids: ['a', 'b'] }])
  assert.deepEqual(b.nodes.map((n) => n.id), ['c']); assert.ok(!('cluster' in b.nodes[0]))
})

import { copyPayload, parsePayload, pasteOps } from '../src/core/arrange.js'
test('复制粘贴:副本组合换新 id,两组各自独立,结构保持', () => {
  let b = mk(N('a', 0, 0), N('b', 200, 0))
  b = run(b, groupOps(b, ['a', 'b'], 'G'))
  let k = 0
  const { ops, ids: newIds } = pasteOps(parsePayload(copyPayload(b, ['a', 'b'])), { boardId: 'b', newId: (p) => p + 'new' + k++ })
  const r = run(b, ops)
  const [ca, cb] = newIds.map((i) => r.nodes.find((n) => n.id === i).cluster)
  assert.equal(ca, cb); assert.notEqual(ca, 'G')
  assert.deepEqual(ids(membersOf(r, ['G'])), ['a', 'b'])      // 原组合没被污染
  assert.equal(membersOf(r, [ca]).length, 2)
})

// ---------- 框 + 卡片一起移动不应重复位移 ----------
const GRP = (id, x, y, w, h) => ({ op: 'addNode', node: { id, type: 'group', x, y, width: w, height: h } })
const posOf = (b) => Object.fromEntries(b.nodes.map((n) => [n.id, [n.x, n.y]]))

test('moveNodes:同时给出框和框内卡片,卡片只移动一次', () => {
  const b = mk(GRP('F', 0, 0, 400, 300), N('in', 50, 50), N('out', 600, 0))
  const r = run(b, [{ op: 'moveNodes', ids: ['F', 'in'], dx: 30, dy: 20 }])
  assert.deepEqual(posOf(r).F, [30, 20])
  assert.deepEqual(posOf(r).in, [80, 70])   // 50+30, 50+20,不是 110/90
  assert.deepEqual(posOf(r).out, [600, 0])
})

test('moveNodes 的语义:移动框会带走框内卡片,所以"先移框、再单独移框内卡片"是两次位移(调用方应合并成一条)', () => {
  const b = mk(GRP('F', 0, 0, 400, 300), N('in', 50, 50))
  const one = run(b, [{ op: 'moveNodes', ids: ['F', 'in'], dx: 30, dy: 20 }])
  const two = run(b, [{ op: 'moveNodes', ids: ['F'], dx: 30, dy: 20 }, { op: 'moveNodes', ids: ['in'], dx: 30, dy: 20 }])
  assert.deepEqual(posOf(one).in, [80, 70])    // 一条 op:恰好一次
  assert.deepEqual(posOf(two).in, [110, 90])   // 两条 op:第二条又移动了一次 —— 这是 UI 曾经错位的原因
  assert.deepEqual(posOf(two).F, posOf(one).F)
})

test('moveNodes:多个框互相包含的节点、重叠框,每个节点最多移动一次', () => {
  const b = mk(GRP('A', 0, 0, 400, 300), GRP('B', 50, 50, 200, 150), N('c', 100, 100))
  const r = run(b, [{ op: 'moveNodes', ids: ['A', 'B', 'c'], dx: 10, dy: 10 }])
  assert.deepEqual(posOf(r).c, [110, 110]); assert.deepEqual(posOf(r).A, [10, 10]); assert.deepEqual(posOf(r).B, [60, 60])
})

test('moveNodes:组合里同时有框和卡片,移动整组 = 每个成员恰好位移一次', () => {
  let b = mk(GRP('F', 0, 0, 400, 300), N('in', 50, 50), N('side', 500, 100))
  b = run(b, groupOps(b, ['F', 'in', 'side'], 'G'))
  const ids3 = unitsOf(b, ['F']).flatMap((u) => u.nodes.map((n) => n.id))
  assert.deepEqual(ids3.sort(), ['F', 'in', 'side'])
  const r = run(b, [{ op: 'moveNodes', ids: ids3, dx: 100, dy: 50 }])
  assert.deepEqual(posOf(r), { F: [100, 50], in: [150, 100], side: [600, 150] })
})
