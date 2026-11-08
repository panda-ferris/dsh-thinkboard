import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, normalizeBoard, serializeBoard, summarize } from '../src/core/model.js'
import { applyOps, ensureIds, OpError } from '../src/core/ops.js'
import { snapMove, boundsOf } from '../src/core/geometry.js'

const R = (x, y, w = 100, h = 60) => ({ x, y, w, h })

test('model: 序列化稳定、往返无损、保留未知字段与未知类型', () => {
  let b = createBoard({ id: 'b1', title: 'T' })
  b = applyOps(b, [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, text: '# hi', futureField: { k: 1 } } },
    { op: 'addNode', node: { id: 'h', type: 'html', x: 10, y: 10, html: '<b>x</b>' } },
  ]).board
  const s1 = serializeBoard(b)
  const back = normalizeBoard(JSON.parse(s1))
  assert.equal(serializeBoard(back), s1)
  assert.deepEqual(back.nodes.find((n) => n.id === 'a').futureField, { k: 1 })
  assert.equal(back.nodes.find((n) => n.id === 'h').type, 'html')
  assert.equal(s1.split('\n').filter((l) => l.includes('"id":"a"')).length, 1) // 一个节点一行
})

test('model: 拒绝更高版本;丢弃悬空连线与重复 id', () => {
  assert.throws(() => normalizeBoard({ schemaVersion: 99, id: 'x' }), /newer version/)
  const b = normalizeBoard({
    id: 'x',
    nodes: [{ id: 'a', type: 'text' }, { id: 'a', type: 'text' }],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'zzz' }],
  })
  assert.equal(b.nodes.length, 1)
  assert.equal(b.edges.length, 0)
})

test('ops: 原子性——后面的操作失败,前面的也不生效', () => {
  const b = createBoard({ id: 'b' })
  assert.throws(
    () => applyOps(b, [{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } }, { op: 'removeNodes', ids: ['nope'] }]),
    (e) => e instanceof OpError && /op\[1\]/.test(e.message),
  )
  assert.equal(b.nodes.length, 0)
})

test('ops: 相对定位', () => {
  let b = createBoard({ id: 'b' })
  b = applyOps(b, [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 } },
    { op: 'addNode', node: { id: 'r', type: 'text', place: { rightOf: 'a' } } },
    { op: 'addNode', node: { id: 'd', type: 'text', place: { below: 'a', gap: 10 } } },
  ]).board
  assert.deepEqual([b.nodes[1].x, b.nodes[1].y], [140, 0])
  assert.deepEqual([b.nodes[2].x, b.nodes[2].y], [0, 60])
})

test('ops: 移动框带动框内卡片和连线跟随;框外卡片不动', () => {
  let b = createBoard({ id: 'b' })
  b = applyOps(b, [
    { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300 } },
    { op: 'addNode', node: { id: 'in', type: 'text', x: 50, y: 50, width: 100, height: 60 } },
    { op: 'addNode', node: { id: 'out', type: 'text', x: 600, y: 50, width: 100, height: 60 } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'in', toNode: 'out' } },
  ]).board
  b = applyOps(b, [{ op: 'moveNodes', ids: ['g'], dx: 10, dy: 20 }]).board
  const p = (id) => b.nodes.find((n) => n.id === id)
  assert.deepEqual([p('g').x, p('g').y, p('in').x, p('in').y, p('out').x], [10, 20, 60, 70, 600])
})

test('ops: 删除节点级联删除连线;不能改 id/type;不能自连', () => {
  let b = createBoard({ id: 'b' })
  b = applyOps(b, [
    { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'c', type: 'text', x: 500, y: 0 } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'c', label: '关系' } },
  ]).board
  assert.throws(() => applyOps(b, [{ op: 'updateNode', id: 'a', patch: { type: 'image' } }]), /cannot change/)
  assert.throws(() => applyOps(b, [{ op: 'addEdge', edge: { fromNode: 'a', toNode: 'a' } }]), /itself/)
  b = applyOps(b, [{ op: 'removeNodes', ids: ['a'] }]).board
  assert.equal(b.edges.length, 0)
})

test('ops: patch 里 null 表示删除字段;ensureIds 让乐观结果与落盘一致', () => {
  let b = createBoard({ id: 'b' })
  const ops = ensureIds([{ op: 'addNode', node: { type: 'text', x: 0, y: 0, title: 'x' } }])
  b = applyOps(b, ops).board
  const id = b.nodes[0].id
  assert.ok(id)
  assert.equal(applyOps(createBoard({ id: 'b' }), ops).board.nodes[0].id, id)
  b = applyOps(b, [{ op: 'updateNode', id, patch: { title: null } }]).board
  assert.equal('title' in b.nodes[0], false)
})

test('summarize: 截断长文本,给 agent 读', () => {
  let b = createBoard({ id: 'b' })
  b = applyOps(b, [{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, text: 'x'.repeat(500) } }]).board
  assert.ok(summarize(b).nodes[0].text.length < 210)
  assert.equal(summarize(b, { full: true }).nodes[0].text.length, 500)
})

// ---------- geometry ----------
test('snap: 左边对齐吸附并给出竖线', () => {
  const r = snapMove(R(103, 300), [R(100, 0)], 6)
  assert.equal(r.dx, -3)
  assert.ok(r.guides.some((g) => g.axis === 'x' && g.pos === 100))
})

test('snap: 超过阈值不吸附', () => {
  const r = snapMove(R(120, 300), [R(100, 0)], 6)
  assert.equal(r.dx, 0)
  assert.equal(r.guides.filter((g) => g.axis === 'x').length, 0)
})

test('snap: 中线对齐', () => {
  // 被拖元素宽 40、目标宽 100:左/右边都离目标很远,只有中线(被拖中心 x=253 ≈ 目标中心 250)在阈值内
  const r = snapMove(R(233, 200, 40, 60), [R(200, 0, 100, 60)], 6)
  assert.equal(r.dx, -3)
  assert.ok(r.guides.some((g) => g.axis === 'x' && g.pos === 250))
})

test('snap: 夹在两块之间等间距', () => {
  // a: 0..100  b: 300..400  moving 宽 100,应落在 150..250(两侧各 50)
  const r = snapMove(R(147, 0), [R(0, 0), R(300, 0)], 6)
  assert.equal(150, 147 + r.dx)
  const xs = r.gaps.filter((g) => g.axis === 'x')
  assert.equal(xs.length, 2)
  assert.deepEqual(xs.map((g) => g.value), [50, 50])
})

test('snap: 沿用相邻两块的间距继续排列', () => {
  // a:0..100, b:150..250 (间距50);moving 应落在 300..400
  const r = snapMove(R(303, 0), [R(0, 0), R(150, 0)], 6)
  assert.equal(300, 303 + r.dx)
  assert.ok(r.gaps.some((g) => g.axis === 'x' && g.value === 50))
})

test('snap: 垂直方向无重叠的块不参与水平间距', () => {
  const r = snapMove(R(147, 500), [R(0, 0), R(300, 0)], 6)
  assert.equal(r.gaps.length, 0)
})

test('boundsOf', () => {
  assert.deepEqual(boundsOf([R(0, 0), R(200, 100)]), { x: 0, y: 0, w: 300, h: 160 })
})

// ---------- 对齐线只在真正吸附时显示 ----------
test('snap: 离开吸附阈值后对齐线立即消失(线只在吸附生效时可见)', () => {
  const target = R(100, 0, 200, 100)
  const seen = (raw) => snapMove(R(raw, 300, 200, 100), [target], 6).guides.filter((g) => g.axis === 'x').length
  assert.ok(seen(100) > 0)              // 正好对齐
  assert.ok(seen(105) > 0)              // 阈值内,吸附
  assert.equal(seen(107), 0)            // 刚出阈值:线必须消失
  assert.equal(seen(94 - 1), 0)
  assert.equal(seen(120), 0)
})

test('snap: 每一段"线可见"的连续区间宽度 ≤ 2×阈值(不会比吸附区更宽)', () => {
  const target = R(100, 0, 200, 100)
  for (const th of [6, 12, 24]) {
    const segs = []
    let cur = null
    for (let raw = 0; raw <= 400; raw += 0.5) {
      const vis = snapMove(R(raw, 300, 200, 100), [target], th).guides.some((g) => g.axis === 'x')
      if (vis) { if (!cur) { cur = [raw, raw]; segs.push(cur) } else cur[1] = raw } else cur = null
    }
    assert.ok(segs.length >= 2, '应有多段(左对齐、右对齐、中线…)')
    for (const [lo, hi] of segs) assert.ok(hi - lo <= 2 * th + 1e-9, `th=${th} 某段 ${lo}..${hi} 宽 ${hi - lo}`)
    // 段与段之间必须有"无线"的空隙(以前几乎没有)
    for (let i = 1; i < segs.length; i++) assert.ok(segs[i][0] - segs[i - 1][1] > 0.5)
  }
})

test('snap: 只有吸附发生的那个轴画线;另一个轴没吸附就不画', () => {
  const target = R(100, 100, 200, 100)
  // x 轴贴近(左边对齐);y 轴远离任何对齐位置
  const r = snapMove(R(103, 600, 200, 100), [target], 6)
  assert.ok(r.guides.some((g) => g.axis === 'x'))
  assert.ok(!r.guides.some((g) => g.axis === 'y'))
  assert.equal(r.dy, 0)
})

test('snap: 密集场景下,沿路径移动时多数位置没有线(以前 94% 的位置有线)', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 37, y: 100 + i * 80, w: 60 + (i % 4) * 40, h: 50 }))
  let visible = 0, total = 0
  for (let raw = 0; raw <= 500; raw++) { total++; if (snapMove(R(raw, 700, 140, 80), many, 6).guides.some((g) => g.axis === 'x')) visible++ }
  assert.ok(visible / total < 0.6, `可见比例 ${(visible / total * 100).toFixed(0)}%`)
})

test('snap: 吸附位移与画出的线位置一致(线画在吸附后的位置上)', () => {
  const target = R(100, 0, 200, 100)
  const r = snapMove(R(104, 300, 200, 100), [target], 6)
  assert.equal(r.dx, -4)
  const g = r.guides.find((x) => x.axis === 'x')
  assert.equal(g.pos, 100)
})

test('snap: 间距提示只在发生等间距吸附时显示', () => {
  const others = [R(0, 0), R(300, 0)]
  const near = snapMove(R(147, 0), others, 6)
  assert.ok(near.gaps.some((g) => g.axis === 'x'))
  const far = snapMove(R(170, 0), others, 6)       // 离等间距位置 20,出阈值
  assert.equal(far.gaps.filter((g) => g.axis === 'x').length, 0)
})

test('summarize: 带出折叠状态与默认高度;旧的 collapsed 字段按 fold:collapsed 呈现;默认状态不多带字段', () => {
  const b = { id: 'b', title: 't', edges: [], nodes: [
    { id: 'd', type: 'text', x: 0, y: 0, width: 10, height: 10 },
    { id: 'c', type: 'text', x: 0, y: 0, width: 10, height: 10, fold: 'collapsed', baseHeight: 300.4 },
    { id: 'e', type: 'text', x: 0, y: 0, width: 10, height: 10, fold: 'expanded' },
    { id: 'o', type: 'text', x: 0, y: 0, width: 10, height: 10, collapsed: true, expandedHeight: 480 },
  ] }
  const [d, c, e, o] = summarize(b).nodes
  assert.ok(!('fold' in d) && !('baseHeight' in d))
  assert.deepEqual([c.fold, c.baseHeight], ['collapsed', 300])
  assert.equal(e.fold, 'expanded'); assert.ok(!('baseHeight' in e))
  assert.equal(o.fold, 'collapsed')
})
