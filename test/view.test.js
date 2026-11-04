import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard } from '../src/core/model.js'
import { applyOps } from '../src/core/ops.js'
import { placeFloating, worldToScreen, searchBoard, snippet, focusViewport, minimapLayout, toMap, fromMap, viewportFromMap, viewportWorldRect } from '../src/core/view.js'

const VP = { left: 0, top: 0, right: 1000, bottom: 600 }
const SZ = { w: 300, h: 40 }

// ---- 悬浮条定位 ----
test('place: 默认在目标上方居中,留 gap', () => {
  const r = placeFloating({ x: 400, y: 300, w: 200, h: 100 }, SZ, VP, { gap: 10 })
  assert.deepEqual([r.x, r.y, r.side], [350, 250, 'above'])
})

test('place: 上方放不下 → 放到下方', () => {
  const r = placeFloating({ x: 400, y: 20, w: 200, h: 100 }, SZ, VP)
  assert.equal(r.side, 'below'); assert.equal(r.y, 130)
})

test('place: 水平方向夹在视口内(左/右边缘)', () => {
  assert.equal(placeFloating({ x: 0, y: 300, w: 40, h: 40 }, SZ, VP).x, 8)
  assert.equal(placeFloating({ x: 980, y: 300, w: 40, h: 40 }, SZ, VP).x, 1000 - 8 - 300)
})

test('place: 目标滚出视口 → 浮条贴边,仍然可见可点', () => {
  const up = placeFloating({ x: 400, y: -500, w: 200, h: 100 }, SZ, VP)
  assert.equal(up.side, 'pinned-top'); assert.ok(up.y >= 8)
  const down = placeFloating({ x: 400, y: 900, w: 200, h: 100 }, SZ, VP)
  assert.equal(down.side, 'pinned-bottom'); assert.ok(down.y + SZ.h <= 600 - 8)
})

test('place: 目标几乎占满视口 → 放在视口内,不越界', () => {
  const r = placeFloating({ x: 0, y: 0, w: 1000, h: 600 }, SZ, VP)
  assert.ok(r.y >= 8 && r.y + SZ.h <= 600 - 8)
})

test('place: 为顶部/底部固定元素预留空间', () => {
  const r = placeFloating({ x: 400, y: 30, w: 200, h: 100 }, SZ, VP, { reserveTop: 40 })
  assert.ok(r.y >= 48)
})

test('任意位置的结果都不越出视口(随机性质测试)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 500; i++) {
    const t = { x: rnd() * 3000 - 1000, y: rnd() * 3000 - 1000, w: 20 + rnd() * 1200, h: 20 + rnd() * 900 }
    const r = placeFloating(t, SZ, VP)
    assert.ok(r.x >= 8 && r.x + SZ.w <= 992 && r.y >= 8 && r.y + SZ.h <= 592, JSON.stringify({ t, r }))
  }
})

test('worldToScreen', () => {
  assert.deepEqual(worldToScreen({ x: 100, y: 50, w: 200, h: 80 }, { x: 10, y: 20, k: 2 }), { x: 210, y: 120, w: 400, h: 160 })
})

// ---- 搜索 ----
const board = () => applyOps(createBoard({ id: 'b' }), [
  { op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0, title: 'Redis 缓存', text: '热点数据放进缓存,过期时间 5 分钟' } },
  { op: 'addNode', node: { id: 'b', type: 'text', x: 0, y: 0, title: '部署', text: '先部署 Redis,再切流量' } },
  { op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, label: '缓存方案' } },
  { op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, file: 'assets/x.png' } },
  { op: 'addEdge', edge: { id: 'e', fromNode: 'a', toNode: 'b', label: '依赖 redis' } },
]).board

test('search: 不区分大小写;标题命中排在正文命中前面', () => {
  const r = searchBoard(board(), 'REDIS')
  assert.deepEqual(r.map((x) => x.id), ['a', 'e', 'b'])
  assert.equal(r[0].field, 'title'); assert.equal(r[2].field, 'text')
})

test('search: 多个词必须全部命中', () => {
  assert.deepEqual(searchBoard(board(), '缓存 过期').map((x) => x.id), ['a'])
  assert.deepEqual(searchBoard(board(), 'redis 不存在的词'), [])
})

test('search: 框按标题搜索;连线按文字搜索;图片没有文字不会被命中', () => {
  const r = searchBoard(board(), '缓存')
  assert.ok(r.some((x) => x.id === 'g' && x.type === 'group'))
  assert.ok(!r.some((x) => x.id === 'i'))
  assert.equal(searchBoard(board(), '依赖')[0].kind, 'edge')
})

test('search: 空查询/纯空白 → 无结果;limit 生效', () => {
  assert.deepEqual(searchBoard(board(), '   '), [])
  assert.equal(searchBoard(board(), 'redis', { limit: 1 }).length, 1)
})

test('snippet: 命中处居中、省略号、去 Markdown 记号', () => {
  const s = snippet('# 标题\n' + 'x'.repeat(100) + ' **目标词** ' + 'y'.repeat(100), ['目标词'], 10)
  assert.ok(s.startsWith('…') && s.endsWith('…') && s.includes('目标词') && !s.includes('*') && !s.includes('#'))
  assert.equal(snippet('', ['a']), '')
})

test('focusViewport: 目标居中', () => {
  const v = focusViewport({ x: 1000, y: 500, w: 200, h: 100 }, { w: 800, h: 600 })
  assert.ok(Math.abs((1100 * v.k + v.x) - 400) < 1e-6 && Math.abs((550 * v.k + v.y) - 300) < 1e-6)
  assert.ok(v.k <= 1.2 && v.k >= 0.25)
})

// ---- 小地图 ----
test('minimap: 内容与视口都落在地图内,宽高不超上限', () => {
  const b = board()
  b.nodes[0].x = 2000; b.nodes[0].y = 1500
  const vp = { x: -500, y: -400, w: 1200, h: 800 }
  const L = minimapLayout(b, vp, { width: 180, maxHeight: 130 })
  assert.ok(L.w <= 180 && L.h <= 130)
  for (const r of [...b.nodes.map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height })), vp]) {
    const p = toMap(L, r.x, r.y), q = toMap(L, r.x + r.w, r.y + r.h)
    assert.ok(p.x >= 0 && p.y >= 0 && q.x <= L.w + 0.5 && q.y <= L.h + 0.5, JSON.stringify([p, q, L]))
  }
})

test('minimap: toMap/fromMap 互逆;点击地图 → 视口中心就是点击的 world 点', () => {
  const L = minimapLayout(board(), { x: 0, y: 0, w: 800, h: 600 })
  const p = fromMap(L, 33, 21); const m = toMap(L, p.x, p.y)
  assert.ok(Math.abs(m.x - 33) < 1e-9 && Math.abs(m.y - 21) < 1e-9)
  const size = { w: 800, h: 600 }
  const v = viewportFromMap(L, 33, 21, size, 1.5)
  const r = viewportWorldRect(v, size)
  assert.ok(Math.abs(r.x + r.w / 2 - p.x) < 1e-6 && Math.abs(r.y + r.h / 2 - p.y) < 1e-6)
})
