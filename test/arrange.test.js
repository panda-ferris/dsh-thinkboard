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

import { dropTarget, memberCount, DROP_SLACK, DROP_SLACK_OUT } from '../src/core/arrange.js'

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

test('dropTarget: 边界值——框内与缓冲带内算放入,出了缓冲带不算', () => {
  const b = make({ op: 'addNode', node: { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300 } }, T('c', 600, 100, 100, 60))
  assert.equal(dropTarget(b, ['c'], -250, 0).target, 'g')                    // 中心 x=400,正好在框边上
  assert.equal(dropTarget(b, ['c'], -249, 0).target, 'g')                    // 中心 x=401:越界 1px,仍在缓冲带内(框会跟着长)
  assert.equal(dropTarget(b, ['c'], -250 + DROP_SLACK, 0).target, 'g')       // 越界 = 缓冲带边缘
  assert.equal(dropTarget(b, ['c'], -250 + DROP_SLACK + 1, 0).target, null)  // 出了缓冲带
  assert.equal(dropTarget(b, ['c'], -250 + DROP_SLACK + 1, 0, { slack: 0, slackOut: 0 }).target, null)
  assert.equal(dropTarget(b, ['c'], -249, 0, { slack: 0, slackOut: 0 }).target, null, 'slack=0 时退回严格几何判定')
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

import { growFrameToFit, dropIntoFrameOps } from '../src/core/arrange.js'

const FR = { x: 100, y: 100, width: 400, height: 300 }

test('growFrameToFit: 已装得下 → 不变(null)', () => {
  assert.equal(growFrameToFit(FR, [{ x: 150, y: 160, width: 100, height: 60 }]), null)
})

test('growFrameToFit: 只向需要的方向扩,其余边不动', () => {
  const g = growFrameToFit(FR, [{ x: 450, y: 160, width: 100, height: 60 }])   // 右边超出
  assert.equal(g.x, 100); assert.equal(g.y, 100); assert.equal(g.height, 300)
  assert.equal(g.x + g.width, 574)                                              // 550 + padding 24
})

test('growFrameToFit: 向上扩时留出标题栏高度,卡片不会压在标题上', () => {
  const g = growFrameToFit(FR, [{ x: 150, y: 40, width: 100, height: 60 }])
  assert.equal(g.y, 40 - 44)                                                    // 卡片顶边之上 44px 给标题
  assert.equal(g.y + g.height, 400)                                             // 下沿保持
})

test('growFrameToFit: 只增不缩——拖入一张小卡片,框不会变小', () => {
  const g = growFrameToFit(FR, [{ x: 480, y: 380, width: 60, height: 40 }])
  assert.ok(g.x <= FR.x && g.y <= FR.y && g.x + g.width >= FR.x + FR.width && g.y + g.height >= FR.y + FR.height)
})

test('growFrameToFit: 多个元素取并集;左上同时超出两个方向', () => {
  const g = growFrameToFit(FR, [{ x: 20, y: 30, width: 80, height: 50 }, { x: 600, y: 500, width: 80, height: 50 }])
  assert.equal(g.x, 20 - 24); assert.equal(g.y, 30 - 44)
  assert.equal(g.x + g.width, 680 + 24); assert.equal(g.y + g.height, 550 + 24)
})

test('growFrameToFit: 空输入 → null', () => { assert.equal(growFrameToFit(FR, []), null) })

test('dropIntoFrameOps: 框扩大,被拖节点本身不动;框内已有元素不受影响', () => {
  const b = make(
    { op: 'addNode', node: { id: 'F', type: 'group', ...FR } },
    T('old', 150, 160, 100, 60), T('mv', 700, 200, 100, 60),
  )
  const ops = dropIntoFrameOps(b, 'F', ['mv'], -200, 0)       // mv 落到 x=500..600,超出框右边 500
  assert.equal(ops.length, 1); assert.equal(ops[0].op, 'updateNode'); assert.equal(ops[0].id, 'F')
  const r = applyOps(b, ops).board
  const f = r.nodes.find((n) => n.id === 'F')
  assert.ok(f.x + f.width >= 600 + 24)
  assert.deepEqual(r.nodes.find((n) => n.id === 'old').x, 150)  // 没动
})

test('dropIntoFrameOps: 框本身被拖动、非框目标、已装得下 → 没有操作', () => {
  const b = make({ op: 'addNode', node: { id: 'F', type: 'group', ...FR } }, T('a', 150, 160, 100, 60))
  assert.deepEqual(dropIntoFrameOps(b, 'F', ['a'], 10, 10), [])
  assert.deepEqual(dropIntoFrameOps(b, 'nope', ['a'], 0, 0), [])
  assert.deepEqual(dropIntoFrameOps(b, 'F', [], 0, 0), [])
})

test('dropIntoFrameOps: 框被扩大后,拖入的节点中心确实在框内(归属一致)', () => {
  const b = make({ op: 'addNode', node: { id: 'F', type: 'group', ...FR } }, T('mv', 700, 200, 100, 60))
  const moved = applyOps(b, [{ op: 'moveNodes', ids: ['mv'], dx: -230, dy: 0 }, ...dropIntoFrameOps(b, 'F', ['mv'], -230, 0)]).board
  const f = moved.nodes.find((n) => n.id === 'F'), m = moved.nodes.find((n) => n.id === 'mv')
  const cx = m.x + m.width / 2, cy = m.y + m.height / 2
  assert.ok(cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height)
  assert.ok(m.x + m.width <= f.x + f.width && m.x >= f.x && m.y >= f.y && m.y + m.height <= f.y + f.height, '整张卡片都在框内,而不仅是中心')
})

import { containedBy } from '../src/core/ops.js'

test('框扩张不吞掉框外的邻居(邻居的中心点不能因此落进框)', () => {
  const b = make(
    { op: 'addNode', node: { id: 'F', type: 'group', ...FR } },
    T('in', 150, 160, 100, 60), T('mv', 700, 200, 100, 60), T('near', 520, 180, 100, 60),
  )
  const ops = dropIntoFrameOps(b, 'F', ['mv'], -200, 0)
  const r = applyOps(b, [{ op: 'moveNodes', ids: ['mv'], dx: -200, dy: 0 }, ...ops]).board
  const members = containedBy(r, r.nodes.find((n) => n.id === 'F')).map((n) => n.id).sort()
  assert.deepEqual(members, ['in', 'mv'])
})

test('框扩张:被拖元素的中心点始终在框内(归属以中心点为准)', () => {
  const b = make({ op: 'addNode', node: { id: 'F', type: 'group', ...FR } }, T('mv', 700, 200, 200, 60), T('near', 520, 180, 100, 60))
  const r = applyOps(b, [{ op: 'moveNodes', ids: ['mv'], dx: -230, dy: 0 }, ...dropIntoFrameOps(b, 'F', ['mv'], -230, 0)]).board
  const f = r.nodes.find((n) => n.id === 'F'), m = r.nodes.find((n) => n.id === 'mv')
  const cx = m.x + m.width / 2, cy = m.y + m.height / 2
  assert.ok(cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height)
})

test('框扩张:没有邻居阻挡时仍完整包住(行为与无邻居版本一致)', () => {
  const b = make({ op: 'addNode', node: { id: 'F', type: 'group', ...FR } }, T('mv', 700, 200, 100, 60))
  const r = applyOps(b, [{ op: 'moveNodes', ids: ['mv'], dx: -200, dy: 0 }, ...dropIntoFrameOps(b, 'F', ['mv'], -200, 0)]).board
  const f = r.nodes.find((n) => n.id === 'F'), m = r.nodes.find((n) => n.id === 'mv')
  assert.ok(m.x >= f.x && m.x + m.width <= f.x + f.width && m.y >= f.y && m.y + m.height <= f.y + f.height)
})

// ---------- 缓冲带与迟滞:往外推时框要跟着长 ----------
const BF = () => make({ op: 'addNode', node: { id: 'F', type: 'group', x: 100, y: 100, width: 300, height: 220 } }, T('mv', 700, 200, 140, 70), T('ex', 130, 150, 100, 60))
// 卡片宽 140:中心 x = 770 + dx;框右边 x=400

const EDGE = 400                                   // BF 的框右边
const dxFor = (cx) => cx - 770                     // 卡片中心从 770 移到 cx

test('dropTarget 缓冲带:中心越过框原边界一点点,仍判定为放入(框来得及跟着长)', () => {
  const b = BF()
  assert.equal(dropTarget(b, ['mv'], dxFor(380), 0).target, 'F')                          // 框内
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + 10), 0).target, 'F')                    // 越界 10
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK - 1), 0).target, 'F')        // 缓冲带内最后 1px
})

test('dropTarget 缓冲带:超出缓冲带视为离开', () => {
  const b = BF()
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK + 1), 0).target, null)
  assert.equal(dropTarget(b, ['mv'], dxFor(600), 0).target, null)
})

test('dropTarget 迟滞:已放入时,需要走出更宽的范围才算离开(进入容易、离开难)', () => {
  const b = BF()
  const out = EDGE + DROP_SLACK + 20                                                      // 没放入过时已在缓冲带外
  assert.equal(dropTarget(b, ['mv'], dxFor(out), 0).target, null)
  assert.equal(dropTarget(b, ['mv'], dxFor(out), 0, { prev: 'F' }).target, 'F')           // 已放入:仍算在里面
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK_OUT - 1), 0, { prev: 'F' }).target, 'F')
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK_OUT + 1), 0, { prev: 'F' }).target, null)   // 走出迟滞范围才离开
})

test('迟滞范围必须大于进入范围,否则没有迟滞效果', () => {
  assert.ok(DROP_SLACK_OUT > DROP_SLACK)
})

test('dropTarget 缓冲带:严格落在框内的优先于只在缓冲带里的(相邻框不抢)', () => {
  const b = make(
    { op: 'addNode', node: { id: 'A', type: 'group', x: 0, y: 0, width: 300, height: 200 } },
    { op: 'addNode', node: { id: 'B', type: 'group', x: 310, y: 0, width: 300, height: 200 } },
    T('mv', 700, 50, 100, 60),
  )
  assert.equal(dropTarget(b, ['mv'], 180 - 750, 0).target, 'A')   // 中心 x=180:严格在 A;离 B 的缓冲带也近
  assert.equal(dropTarget(b, ['mv'], 400 - 750, 0).target, 'B')   // 严格在 B
  assert.equal(dropTarget(b, ['mv'], 305 - 750, 0).target, 'A')   // 缝隙里:都在缓冲带,取面积最小(相同则先列出的)
})

test('dropTarget 缓冲带:按屏幕像素换算(slack 随缩放传入)', () => {
  const b = BF()
  // 缩放 0.5:屏幕像素换算成 world 要放大 2 倍
  const k = 0.5, o = { slack: DROP_SLACK / k, slackOut: DROP_SLACK_OUT / k }
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK / k - 1), 0, o).target, 'F')
  assert.equal(dropTarget(b, ['mv'], dxFor(EDGE + DROP_SLACK / k + 1), 0, o).target, null)
})

test('缓冲带内松手:归属与预览一致——卡片中心确实在(已扩大的)框内', () => {
  const b = BF()
  for (const cx of [380, 410, EDGE + DROP_SLACK - 1]) {
    const dx = cx - 770
    assert.equal(dropTarget(b, ['mv'], dx, 0).target, 'F')
    const r = applyOps(b, [{ op: 'moveNodes', ids: ['mv'], dx, dy: 0 }, ...dropIntoFrameOps(b, 'F', ['mv'], dx, 0)]).board
    const f = r.nodes.find((n) => n.id === 'F'), m = r.nodes.find((n) => n.id === 'mv')
    assert.ok(m.x + m.width / 2 >= f.x && m.x + m.width / 2 <= f.x + f.width, `cx=${cx}`)
    assert.ok(m.x >= f.x && m.x + m.width <= f.x + f.width, `cx=${cx} 整张卡片也在框内`)
    assert.ok(containedBy(r, f).some((n) => n.id === 'mv'), `cx=${cx} 成员关系成立`)
  }
})
