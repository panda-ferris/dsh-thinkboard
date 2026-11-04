import test from 'node:test'
import assert from 'node:assert/strict'
import { SHAPE_KINDS, SHAPE_DEFAULT_SIZE, shapeGeometry, shapeAnchors, quickAddPlan } from '../src/core/shapes.js'
import { anchorPoint, edgeGeometry, orthogonalBetween, simplify, midOfPolyline, edgeEnds } from '../src/core/edges.js'
import { createBoard } from '../src/core/model.js'
import { applyOps } from '../src/core/ops.js'

// ---------- 把 SVG 路径采样成点,用于几何断言(只需支持 M L H V Z A C) ----------
function sample(d) {
  const toks = d.match(/[MLHVZACmlhvzac]|-?\d*\.?\d+(?:e-?\d+)?/g)
  const pts = []
  let i = 0, cur = { x: 0, y: 0 }, start = null, cmd = ''
  const num = () => Number(toks[i++])
  const line = (p) => { for (let t = 1; t <= 40; t++) pts.push({ x: cur.x + (p.x - cur.x) * t / 40, y: cur.y + (p.y - cur.y) * t / 40 }); cur = p }
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++]
    if (cmd === 'M') { cur = { x: num(), y: num() }; start = cur; pts.push(cur); cmd = 'L' }
    else if (cmd === 'L') line({ x: num(), y: num() })
    else if (cmd === 'H') line({ x: num(), y: cur.y })
    else if (cmd === 'V') line({ x: cur.x, y: num() })
    else if (cmd === 'Z') { if (start) line(start) }
    else if (cmd === 'C') {
      const c1 = { x: num(), y: num() }, c2 = { x: num(), y: num() }, e = { x: num(), y: num() }, s0 = cur
      for (let t = 1; t <= 60; t++) { const u = t / 60, v = 1 - u; pts.push({ x: v ** 3 * s0.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * e.x, y: v ** 3 * s0.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * e.y }) }
      cur = e
    } else if (cmd === 'A') {
      // 椭圆弧:按端点与半径求圆心(标准 SVG 算法),再采样
      const rx0 = num(), ry0 = num(); num(); const large = num(), sweep = num(); const e = { x: num(), y: num() }
      arc(cur, e, rx0, ry0, large, sweep).forEach((p) => pts.push(p)); cur = e
    } else break
  }
  return pts
}
function arc(p0, p1, rx, ry, fa, fs) {
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
  let lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const sign = fa === fs ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * dy * dy + ry * ry * dx * dx)))
  const cxp = co * ((rx * dy) / ry), cyp = co * (-(ry * dx) / rx)
  const cx = cxp + (p0.x + p1.x) / 2, cy = cyp + (p0.y + p1.y) / 2
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a }
  const t1 = ang(1, 0, (dx - cxp) / rx, (dy - cyp) / ry)
  let dt = ang((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry)
  if (!fs && dt > 0) dt -= 2 * Math.PI
  if (fs && dt < 0) dt += 2 * Math.PI
  const out = []
  for (let k = 1; k <= 60; k++) { const t = t1 + (dt * k) / 60; out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }) }
  return out
}
const nearest = (pts, p) => Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))

test('每种图形都有默认尺寸,且路径可解析', () => {
  assert.equal(SHAPE_KINDS.length, 15)
  for (const k of SHAPE_KINDS) {
    assert.ok(SHAPE_DEFAULT_SIZE[k], k)
    const g = shapeGeometry(k, 160, 100)
    assert.ok(sample(g.d).length > 10, k)
  }
})

test('每种图形的四个连接点都落在轮廓上(多种宽高比)', () => {
  for (const k of SHAPE_KINDS) {
    for (const [w, h] of [[160, 100], [80, 200], [300, 60], [120, 120]]) {
      const pts = sample(shapeGeometry(k, w, h).d)
      const an = shapeAnchors(k, w, h)
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const dist = nearest(pts, an[side])
        assert.ok(dist < Math.max(w, h) * 0.015 + 0.6, `${k} ${w}x${h} ${side} 离轮廓 ${dist.toFixed(2)}`)
      }
    }
  }
})

test('图形轮廓都在外包盒内(不画出界)', () => {
  for (const k of SHAPE_KINDS) {
    const pts = sample(shapeGeometry(k, 160, 100).d)
    for (const p of pts) assert.ok(p.x >= -0.6 && p.x <= 160.6 && p.y >= -0.6 && p.y <= 100.6, `${k} ${p.x},${p.y}`)
  }
})

test('文字区在外包盒内且有正面积', () => {
  for (const k of SHAPE_KINDS) {
    const t = shapeGeometry(k, 160, 100).text
    assert.ok(t.w > 0 && t.h > 0 && t.x >= 0 && t.y >= 0 && t.x + t.w <= 160.01 && t.y + t.h <= 100.01, k)
  }
})

test('anchorPoint:图形节点用图形连接点,卡片仍用边中点', () => {
  const tri = { type: 'shape', kind: 'triangle', x: 100, y: 100, width: 120, height: 100 }
  assert.deepEqual(anchorPoint(tri, 'left'), { x: 130, y: 150 })
  const card = { type: 'text', x: 0, y: 0, width: 100, height: 50 }
  assert.deepEqual(anchorPoint(card, 'left'), { x: 0, y: 25 })
})

// ---------- 正交路由 ----------
const isOrtho = (pts) => pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 0.01 || Math.abs(p.y - pts[i].y) < 0.01)
const box = (x, y, w = 100, h = 60) => ({ x, y, width: w, height: h })

test('正交:左右相向 → 中线换道,所有段水平/垂直,首末段方向正确', () => {
  const A = box(0, 0), B = box(300, 200)
  const g = orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'left'), 'left', A, B)
  assert.ok(isOrtho(g.points))
  assert.ok(g.points[1].x > g.points[0].x && Math.abs(g.points[1].y - g.points[0].y) < 0.01, '向右离开')
  const n = g.points.length
  assert.ok(g.points[n - 1].x > g.points[n - 2].x && Math.abs(g.points[n - 1].y - g.points[n - 2].y) < 0.01, '从左进入')
  assert.ok(n <= 6)
})

test('正交:同一水平线上直接一条直线(合并共线点)', () => {
  const A = box(0, 0), B = box(300, 0)
  const g = orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'left'), 'left', A, B)
  assert.equal(g.points.length, 2)
})

test('正交:上下相向、右出下入(L 形)、同向绕行,全部正交', () => {
  const A = box(0, 0), B = box(200, 300), C = box(-300, 200)
  for (const [fs, ts, to] of [['bottom', 'top', B], ['right', 'top', B], ['right', 'right', B], ['bottom', 'bottom', C], ['left', 'top', B], ['top', 'left', C]]) {
    const g = orthogonalBetween(anchorPoint(A, fs), fs, anchorPoint(to, ts), ts, A, to)
    assert.ok(isOrtho(g.points), `${fs}->${ts}`)
    assert.ok(g.points.length >= 2 && g.points.length <= 6, `${fs}->${ts} ${g.points.length}`)
  }
})

test('正交:连线标签放在折线长度中点', () => {
  assert.deepEqual(midOfPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), { x: 100, y: 0 })
  assert.deepEqual(midOfPolyline([{ x: 0, y: 0 }, { x: 0, y: 50 }]), { x: 0, y: 25 })
})

test('simplify:去重与合并共线', () => {
  const r = simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }])
  assert.deepEqual(r, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }])
})

test('edgeGeometry:按 route 选择路由;直线只有两个点', () => {
  const A = box(0, 0), B = box(300, 200)
  assert.equal(edgeGeometry({ route: 'straight', fromSide: 'right', toSide: 'left' }, A, B).points.length, 2)
  assert.match(edgeGeometry({ fromSide: 'right', toSide: 'left' }, A, B).d, / C /)
  assert.ok(isOrtho(edgeGeometry({ route: 'orthogonal', fromSide: 'right', toSide: 'left' }, A, B).points))
})

test('edgeEnds:新字段优先,兼容旧 arrow 字段', () => {
  assert.deepEqual(edgeEnds({}), { start: 'none', end: 'arrow' })
  assert.deepEqual(edgeEnds({ arrow: 'both' }), { start: 'arrow', end: 'arrow' })
  assert.deepEqual(edgeEnds({ arrow: 'none' }), { start: 'none', end: 'none' })
  assert.deepEqual(edgeEnds({ startEnd: 'dot', endEnd: 'none', arrow: 'both' }), { start: 'dot', end: 'none' })
  assert.deepEqual(edgeEnds({ endEnd: 'weird' }), { start: 'none', end: 'arrow' })
})

// ---------- 四向快速生成 ----------
const shapeBoard = (...nodes) => applyOps(createBoard({ id: 'b' }), nodes.map((node) => ({ op: 'addNode', node }))).board

test('quickAdd:向右生成同类同尺寸图形,中心对齐,带正交连线方向', () => {
  const b = shapeBoard({ id: 's', type: 'shape', kind: 'diamond', x: 0, y: 0, width: 160, height: 100, fill: 'blue' })
  const { node, edge } = quickAddPlan(b, b.nodes[0], 'right')
  assert.deepEqual([node.kind, node.width, node.height, node.x, node.y, node.fill], ['diamond', 160, 100, 220, 0, 'blue'])
  assert.deepEqual(edge, { fromSide: 'right', toSide: 'left', route: 'orthogonal' })
})

test('quickAdd:四个方向位置正确', () => {
  const b = shapeBoard({ id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, width: 100, height: 50 })
  const s = b.nodes[0]
  const pos = (d) => { const n = quickAddPlan(b, s, d, { gap: 40 }).node; return [n.x, n.y] }
  assert.deepEqual(pos('right'), [140, 0]); assert.deepEqual(pos('left'), [-140, 0])
  assert.deepEqual(pos('bottom'), [0, 90]); assert.deepEqual(pos('top'), [0, -90])
})

test('quickAdd:目标位置被占用时错开,不与已有元素重叠', () => {
  const b = shapeBoard(
    { id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, width: 100, height: 50 },
    { id: 'o', type: 'shape', kind: 'rect', x: 160, y: 0, width: 100, height: 50 },
  )
  const n = quickAddPlan(b, b.nodes[0], 'right', { gap: 60 }).node
  const o = b.nodes[1]
  assert.ok(!(n.x < o.x + o.width && n.x + n.width > o.x && n.y < o.y + o.height && n.y + n.height > o.y), JSON.stringify(n))
})

test('quickAdd:可指定生成别的图形(用默认尺寸);非法方向报错', () => {
  const b = shapeBoard({ id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, width: 100, height: 50 })
  const n = quickAddPlan(b, b.nodes[0], 'bottom', { kind: 'diamond' }).node
  assert.deepEqual([n.kind, n.width, n.height], ['diamond', 160, 100])
  assert.throws(() => quickAddPlan(b, b.nodes[0], 'up'), /bad direction/)
})

test('ops:图形按 kind 取默认尺寸;非法 kind / 样式值被拒绝', () => {
  const b = applyOps(createBoard({ id: 'b' }), [
    { op: 'addNode', node: { id: 'd', type: 'shape', kind: 'diamond', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 't', type: 'shape', kind: 'text', x: 0, y: 0, text: '标注' } },
  ]).board
  assert.deepEqual([b.nodes[0].width, b.nodes[0].height], [160, 100])
  assert.deepEqual([b.nodes[1].width, b.nodes[1].height], [200, 40])
  const bad = (node) => assert.throws(() => applyOps(createBoard({ id: 'b' }), [{ op: 'addNode', node: { id: 'x', type: 'shape', x: 0, y: 0, ...node } }]))
  bad({ kind: 'hexagram' }); bad({ kind: 'rect', dash: 'wavy' }); bad({ kind: 'rect', strokeWidth: 99 }); bad({ kind: 'rect', fontSize: 2 }); bad({ kind: 'rect', align: 'justify' }); bad({ kind: 'rect', fill: 3 })
})

test('ops:连线 route / 端点样式校验,含 updateEdge', () => {
  const b = applyOps(createBoard({ id: 'b' }), [
    { op: 'addNode', node: { id: 'a', type: 'shape', kind: 'rect', x: 0, y: 0 } },
    { op: 'addNode', node: { id: 'c', type: 'shape', kind: 'rect', x: 400, y: 0 } },
    { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'c', route: 'orthogonal', startEnd: 'dot', endEnd: 'arrow' } },
  ]).board
  assert.equal(b.edges[0].route, 'orthogonal')
  assert.throws(() => applyOps(b, [{ op: 'updateEdge', id: 'e', patch: { route: 'zigzag' } }]), /route/)
  assert.throws(() => applyOps(b, [{ op: 'updateEdge', id: 'e', patch: { endEnd: 'diamond' } }]), /endEnd/)
  assert.doesNotThrow(() => applyOps(b, [{ op: 'updateEdge', id: 'e', patch: { route: null } }]))
})

// ---------- bend:折线中段可拖动换道 ----------
test('bend: 相向连线的中段随 bend 平移,两端出入方向不变', () => {
  const A = box(0, 0), B = box(400, 200)
  const g0 = orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'left'), 'left', A, B, 0)
  const g1 = orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'left'), 'left', A, B, 60)
  assert.equal(g0.handle.axis, 'x'); assert.equal(g1.handle.axis, 'x')
  assert.ok(Math.abs(g1.handle.x - g0.handle.x - 60) < 0.01)
  assert.ok(isOrtho(g1.points))
  assert.deepEqual(g1.points[0], g0.points[0]); assert.deepEqual(g1.points[g1.points.length - 1], g0.points[g0.points.length - 1])
})

test('bend: C 形连线(同侧出入)的外绕位置可调,拖远/拖近都保持正交', () => {
  const A = box(0, 0), B = box(0, 200)
  const c = (bend) => orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'right'), 'right', A, B, bend)
  const g0 = c(0), g1 = c(80), g2 = c(-20)
  assert.equal(g0.handle.axis, 'x')
  assert.ok(g1.handle.x > g0.handle.x && g2.handle.x < g0.handle.x)
  for (const g of [g0, g1, g2]) assert.ok(isOrtho(g.points))
  // 外绕线在两个图形的右侧之外,能被拖到把图形让开
  assert.ok(g1.handle.x > Math.max(A.x + A.width, B.x + B.width))
})

test('bend: 上下方向的外绕同理(axis 为 y)', () => {
  const A = box(0, 0), B = box(300, 0)
  const g = orthogonalBetween(anchorPoint(A, 'bottom'), 'bottom', anchorPoint(B, 'bottom'), 'bottom', A, B, 40)
  assert.equal(g.handle.axis, 'y'); assert.ok(isOrtho(g.points))
})

test('bend: L 形与直线没有可拖动的中段', () => {
  const A = box(0, 0), B = box(300, 200), C = box(300, 0)
  assert.equal(orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(B, 'top'), 'top', A, B, 50).handle, null)
  assert.equal(orthogonalBetween(anchorPoint(A, 'right'), 'right', anchorPoint(C, 'left'), 'left', A, C, 50).handle, null)
})

test('bend: edgeGeometry 读取 edge.bend;非数字忽略;曲线/直线不受影响', () => {
  const A = box(0, 0), B = box(400, 200)
  const e = { route: 'orthogonal', fromSide: 'right', toSide: 'left' }
  assert.ok(Math.abs(edgeGeometry({ ...e, bend: 50 }, A, B).handle.x - edgeGeometry(e, A, B).handle.x - 50) < 0.01)
  assert.deepEqual(edgeGeometry({ ...e, bend: 'x' }, A, B).handle, edgeGeometry(e, A, B).handle)
  assert.equal(edgeGeometry({ fromSide: 'right', toSide: 'left', bend: 50 }, A, B).d, edgeGeometry({ fromSide: 'right', toSide: 'left' }, A, B).d)
})

import { pathBetween } from '../src/core/edges.js'
test('pathBetween: 两端方向缺失(拖动中的游离端点)也不崩,且给出合法路径', () => {
  for (const [fs, ts] of [[undefined, undefined], ['right', undefined], [undefined, 'left'], ['nope', 'nope']]) {
    const g = pathBetween({ x: 0, y: 0 }, fs, { x: 200, y: 100 }, ts)
    assert.match(g.d, /^M 0 0 C /)
    assert.ok(Number.isFinite(g.mid.x) && Number.isFinite(g.angle))
  }
  // 起终点重合时不产生 NaN
  const z = pathBetween({ x: 5, y: 5 }, undefined, { x: 5, y: 5 }, undefined)
  assert.ok(!/NaN/.test(z.d))
})
