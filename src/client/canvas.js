// 画布:平移缩放 + 节点渲染 + 交互。
// 坐标系:world(画布坐标)→ screen = world * k + (x, y)。整个 world 层只有一个 transform。
//
// 交互状态机放在 ref 里(pointer 事件高频,不进 React state);拖动中的临时位移用"预览偏移"
// 渲染,松手时才 dispatch 一次 ops,因此一次拖动 = 一步撤销、一次落盘。

import React from 'react'
import { layered, findNode } from '../core/model.js'
import { snapMove, boundsOf } from '../core/geometry.js'
import { edgeGeometry, pathBetween, straightBetween, anchorPoint, nearestAnchor, hitNode, SIDES, autoSide, edgeEnds } from '../core/edges.js'
import { quickAddPlan, SHAPE_DEFAULT_SIZE } from '../core/shapes.js'
import { shapeStroke } from './colors.js'
import { containedBy } from '../core/ops.js'
import { selectionUnitFor, enterScope, expandToUnits, unitsOf, groupOps, ungroupOps, scaleOps, clusterPath, bounds as clusterBounds, remapClusters } from '../core/cluster.js'
import { copyPayload, parsePayload, pasteOps, dropTarget as calcDrop, memberCount, growFrameToFit, bystandersOf, DROP_SLACK, DROP_SLACK_OUT } from '../core/arrange.js'
import { uid } from '../core/model.js'
import { NodeView } from './nodes.js'
import { ContextBar, Minimap, SearchBox, Lightbox, useSize } from './overlays.js'
import { LeftToolbar } from './lefttool.js'
import { initialImageSize } from '../core/content.js'
import { COLORS } from './colors.js'

const h = React.createElement
const SNAP_PX = 6
const EDITABLE = new Set(['text', 'html', 'image', 'shape', 'group'])
const MIN_K = 0.1
const MAX_K = 3

export function Canvas({ store, state, transport, t, search, setSearch, detailId, tool, setTool }) {
  const { board, viewport, selection, edgeSelection, editing, scope } = state
  const rootRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const size = useSize(stageRef)
  const [preview_, setPreviewImg] = React.useState(null)
  const replaceRef = React.useRef(null)
  const addFileRef = React.useRef(null)
  const replaceTarget = React.useRef(null)
  const drag = React.useRef(null)
  const [preview, setPreview] = React.useState(null) // { dx, dy, ids:Set, guides, gaps, dropGroup }
  const [marquee, setMarquee] = React.useState(null)
  const [placing, setPlacing] = React.useState(null) // 拖出图形时的虚线框
  const [clusterScale, setClusterScale] = React.useState(null) // { map: id -> {x,y,width,height} }
  const [bendPreview, setBendPreview] = React.useState(null) // 拖动连线中段时的临时 bend
  const [linking, setLinking] = React.useState(null) // { fromId, fromSide, x, y, target }
  const [hoverId, setHoverId] = React.useState(null)
  const [edgeEdit, setEdgeEdit] = React.useState(null)
  const [resize, setResize] = React.useState(null) // { id, width, height }
  const spaceDown = React.useRef(false)
  const lastDown = React.useRef({ t: 0, x: 0, y: 0, id: null }) // 双击检测
  const pendingCollapse = React.useRef(null) // 多选中点了一个节点:没拖动则松手后收缩为单选
  const vp = React.useRef(viewport)
  vp.current = viewport

  const toWorld = (cx, cy) => {
    const r = rootRef.current.getBoundingClientRect()
    return { x: (cx - r.left - vp.current.x) / vp.current.k, y: (cy - r.top - vp.current.y) / vp.current.k }
  }

  // ---- 滚轮:⌘/Ctrl+滚轮或捏合 = 缩放;普通滚轮/触控板 = 平移 ----
  React.useEffect(() => {
    const el = rootRef.current
    const onWheel = (e) => {
      if (e.target.closest('[data-wb-scroll]')) {
        if (!e.ctrlKey && !e.metaKey) return // 卡片内部可滚动内容优先
      }
      e.preventDefault()
      const v = vp.current
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left, py = e.clientY - r.top
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.01), MIN_K, MAX_K)
        store.setViewport({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k })
      } else {
        store.setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [store])

  if (!board) return null
  const nodes = layered(board.nodes)
  const byId = new Map(board.nodes.map((n) => [n.id, n]))
  const live = (n) => {
    // 拖动/缩放中的预览位置
    if (preview && preview.ids.has(n.id)) return { ...n, x: n.x + preview.dx, y: n.y + preview.dy }
    if (preview?.grow && preview.grow.id === n.id) return { ...n, x: preview.grow.x, y: preview.grow.y, width: preview.grow.width, height: preview.grow.height }
    if (clusterScale && clusterScale.map[n.id]) return { ...n, ...clusterScale.map[n.id] }
    if (resize && resize.id === n.id) return { ...n, x: resize.x, y: resize.y, width: resize.width, height: resize.height }
    return n
  }

  // ---- 指针 ----
  /** 判定"双击":350ms 内、位置相差 <6px 的第二次按下。id 为按下处的卡片 id(空白处为 null)。 */
  const isDoubleDown = (e, id) => {
    const p = lastDown.current
    const now = performance.now()
    const dbl = now - p.t < 350 && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6 && p.id === id
    lastDown.current = dbl ? { t: 0, x: 0, y: 0, id: null } : { t: now, x: e.clientX, y: e.clientY, id }
    return dbl
  }
  const finishPlace = (d, keepTool) => {
    setPlacing(null)
    if (!tool) return
    const id = uid('n')
    const at = d.w0, end = d.last || d.w0
    let node
    if (tool.kind === 'shape') {
      const [dw, dh] = SHAPE_DEFAULT_SIZE[tool.shape] || [160, 80]
      node = d.moved
        ? { type: 'shape', kind: tool.shape, x: Math.round(Math.min(at.x, end.x)), y: Math.round(Math.min(at.y, end.y)), width: Math.max(24, Math.round(Math.abs(end.x - at.x))), height: Math.max(24, Math.round(Math.abs(end.y - at.y))), text: '' }
        : { type: 'shape', kind: tool.shape, x: Math.round(at.x - dw / 2), y: Math.round(at.y - dh / 2), width: dw, height: dh, text: '' }
    } else if (tool.kind === 'text') {
      node = { type: 'shape', kind: 'text', x: Math.round(at.x), y: Math.round(at.y - 20), width: d.moved ? Math.max(60, Math.round(Math.abs(end.x - at.x))) : 200, height: 40, text: '' }
    } else {
      node = { type: 'text', x: Math.round(at.x - 160), y: Math.round(at.y - 40), text: '' }
    }
    store.dispatch([{ op: 'addNode', node: { ...node, id } }])
    store.select([id])
    // 图形放下后不立即进入文字编辑(更像飞书:先放好再双击写字);文本和卡片直接编辑
    if (tool.kind !== 'shape') store.setEditing(id)
    if (!keepTool && !tool.sticky) setTool?.(null)
  }

  const addHtmlAtCenter = () => {
    const c0 = viewCenter()
    const id = uid('n')
    store.dispatch([{ op: 'addNode', node: { id, type: 'html', x: Math.round(c0.x - 200), y: Math.round(c0.y - 150), width: 400, height: 300, html: '' } }])
    store.select([id]); store.setEditing(id)
  }

  /** 适配视图:让全部内容刚好落进可见区域。 */
  const fitView = () => {
    if (!board.nodes.length) { store.setViewport({ x: 0, y: 0, k: 1 }); return }
    const r = rootRef.current.getBoundingClientRect()
    const x1 = Math.min(...board.nodes.map((n) => n.x)), y1 = Math.min(...board.nodes.map((n) => n.y))
    const x2 = Math.max(...board.nodes.map((n) => n.x + n.width)), y2 = Math.max(...board.nodes.map((n) => n.y + n.height))
    const pad = 60
    const k0 = Math.min(1.5, Math.max(0.1, Math.min((r.width - pad * 2) / (x2 - x1), (r.height - pad * 2) / (y2 - y1))))
    store.setViewport({ k: k0, x: (r.width - (x2 - x1) * k0) / 2 - x1 * k0, y: (r.height - (y2 - y1) * k0) / 2 - y1 * k0 })
  }

  const addGroupAtCenter = () => {
    const c = viewCenter()
    const id = uid('g')
    store.dispatch([{ op: 'addNode', node: { id, type: 'group', x: Math.round(c.x - 240), y: Math.round(c.y - 160), width: 480, height: 320, label: '', color: 'blue' } }])
    store.select([id])
  }

  const quickAdd = (src, dir) => {
    const plan = quickAddPlan(board, src, dir)
    const id = uid('n')
    store.dispatch([{ op: 'addNode', node: { ...plan.node, id } }, { op: 'addEdge', edge: { fromNode: src.id, toNode: id, ...plan.edge } }])
    store.select([id])
  }

  const createCardAt = (w) => {
    const id = 'n' + Math.random().toString(36).slice(2, 9)
    store.dispatch([{ op: 'addNode', node: { id, type: 'text', x: Math.round(w.x - 160), y: Math.round(w.y - 40), text: '' } }])
    store.select([id])
    store.setEditing(id)
  }

  const onBackgroundDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return
    if (e.target.closest('[data-wb-node],[data-wb-edge],[data-wb-ui]')) return
    rootRef.current.focus()
    if (e.button === 0 && tool) {
      // 放置模式:按下记录起点,拖出大小;不拖则用默认大小居中放置
      e.preventDefault()
      drag.current = { kind: 'place', w0: toWorld(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY }
      rootRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 0 && isDoubleDown(e, null)) { e.preventDefault(); createCardAt(toWorld(e.clientX, e.clientY)); return }
    const pan = e.button === 1 || spaceDown.current
    const start = { cx: e.clientX, cy: e.clientY, vx: vp.current.x, vy: vp.current.y }
    const additive = e.shiftKey
    const w0 = toWorld(e.clientX, e.clientY)
    drag.current = { kind: pan ? 'pan' : 'marquee', start, w0, additive, base: additive ? selection : [] }
    if (!additive) { store.select([]); if (scope.length) store.setScope([]) }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onNodeDown = (e, n) => {
    if (e.button !== 0) return
    if (editing === n.id) return
    if (e.target.closest('[data-wb-handle],[data-wb-anchor],input,textarea,button,[contenteditable=true]')) return
    e.stopPropagation()
    rootRef.current.focus()
    // 注意:isDoubleDown 有副作用(更新"上一次按下"),每次按下只能调用一次
    if (isDoubleDown(e, n.id)) {
      // 组合成员:双击先"进入"组合(选中内一层),再双击才是编辑/放大
      const into = enterScope(n, scope)
      if (into) { e.preventDefault(); store.setScope(into); store.select(selectionUnitFor(board, n, into)); return }
      if (n.type === 'image' && n.file) { e.preventDefault(); setPreviewImg({ src: transport.assetUrl(board.id, n.file), alt: n.caption || n.title }); return }
      if (n.id === detailId) { e.preventDefault(); store.select([n.id]); store.openDetail?.(n.id); return }
      // 框:只有双击"标题栏"才编辑标题(双击框的空白处不该打断操作)
      if (n.type === 'group') {
        const r = e.currentTarget?.getBoundingClientRect?.()
        if (!r || e.clientY - r.top <= 44 * vp.current.k) { e.preventDefault(); store.select([n.id]); store.setEditing(n.id) }
        return
      }
      if (EDITABLE.has(n.type)) { e.preventDefault(); store.select([n.id]); store.setEditing(n.id); return }
    }
    const unit = selectionUnitFor(board, n, scope)
    let sel = selection
    if (e.shiftKey) {
      // Shift:整个单元一起加入/移出
      const all = unit.every((i) => selection.includes(i))
      sel = all ? selection.filter((i) => !unit.includes(i)) : [...new Set([...selection, ...unit])]
    } else if (!selection.includes(n.id)) {
      sel = unit
    } else if (selection.length > 1 && unit.length === 1 && !drag.current) {
      // 已被多选、又点在其中一个"单个节点"上:按下先保持多选(为了能整体拖动),松手时若没有拖动则收缩为单选。
      pendingCollapse.current = n.id
    }
    store.select(sel)
    if (!sel.includes(n.id)) return
    // 移动集合:选中节点;选中了框 → 框内卡片一并动
    const ids = new Set(expandToUnits(board, sel, scope))
    for (const id of sel) {
      const g = byId.get(id)
      if (g?.type === 'group') for (const c of containedBy(board, g)) ids.add(c.id)
    }
    drag.current = { kind: 'move', cx: e.clientX, cy: e.clientY, ids, roots: sel, moved: false }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onResizeDown = (e, n, handle) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind: 'resize', cx: e.clientX, cy: e.clientY, id: n.id, handle, orig: { x: n.x, y: n.y, width: n.width, height: n.height }, ratio: n.type === 'image' ? n.width / n.height : null }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  /** 按下组合/多选单元外包盒上的手柄:整体缩放。 */
  const onUnitResizeDown = (e, handle, rect, nodes) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind: 'unitResize', cx: e.clientX, cy: e.clientY, handle, orig: rect, nodes: nodes.map((n) => ({ ...n })) }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onAnchorDown = (e, n, side) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind: 'link', fromId: n.id, fromSide: side }
    const w = toWorld(e.clientX, e.clientY)
    setLinking({ fromId: n.id, fromSide: side, x: w.x, y: w.y, target: null })
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onBendDown = (e, edge, g) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind: 'bend', id: edge.id, axis: g.handle.axis, start0: Number.isFinite(edge.bend) ? edge.bend : 0, cx: e.clientX, cy: e.clientY }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onEdgeEndDown = (e, edge, end) => {
    e.stopPropagation()
    e.preventDefault()
    // 拖动一端重连:另一端固定
    const fixedId = end === 'from' ? edge.toNode : edge.fromNode
    const fixedSide = (end === 'from' ? edge.toSide : edge.fromSide) || autoSide(byId.get(fixedId), byId.get(end === 'from' ? edge.fromNode : edge.toNode))
    drag.current = { kind: 'reconnect', edge, end, fixedId, fixedSide }
    const w = toWorld(e.clientX, e.clientY)
    setLinking({ fromId: fixedId, fromSide: fixedSide, x: w.x, y: w.y, target: null, reversed: end === 'from' })
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const k = vp.current.k
    if (d.kind === 'bend') {
      const delta = d.axis === 'x' ? (e.clientX - d.cx) / k : (e.clientY - d.cy) / k
      let v = d.start0 + delta
      if (!e.altKey) v = Math.round(v / 4) * 4 // 轻微网格吸附,方便回到整数位置
      if (Math.abs(v) < 6 && !e.altKey) v = 0   // 靠近原位时吸回去
      d.value = Math.round(v)
      setBendPreview({ id: d.id, bend: d.value })
      return
    }
    if (d.kind === 'place') {
      const w = toWorld(e.clientX, e.clientY)
      const moved = Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 4
      setPlacing(moved ? { x: Math.min(d.w0.x, w.x), y: Math.min(d.w0.y, w.y), w: Math.abs(w.x - d.w0.x), h: Math.abs(w.y - d.w0.y) } : null)
      d.last = w
      d.moved = moved
      return
    }
    if (d.kind === 'pan') {
      store.setViewport({ ...vp.current, x: d.start.vx + e.clientX - d.start.cx, y: d.start.vy + e.clientY - d.start.cy })
    } else if (d.kind === 'marquee') {
      const w = toWorld(e.clientX, e.clientY)
      const r = { x: Math.min(d.w0.x, w.x), y: Math.min(d.w0.y, w.y), w: Math.abs(w.x - d.w0.x), h: Math.abs(w.y - d.w0.y) }
      setMarquee(r)
      const hit = board.nodes.filter((n) => n.x < r.x + r.w && n.x + n.width > r.x && n.y < r.y + r.h && n.y + n.height > r.y)
        // 框只在被完整框住时才选中,避免大框总被误选
        .filter((n) => n.type !== 'group' || (n.x >= r.x && n.y >= r.y && n.x + n.width <= r.x + r.w && n.y + n.height <= r.y + r.h))
        .map((n) => n.id)
      store.select(expandToUnits(board, [...new Set([...d.base, ...hit])], scope))
    } else if (d.kind === 'move') {
      let dx = (e.clientX - d.cx) / k, dy = (e.clientY - d.cy) / k
      if (!d.moved && Math.hypot(dx, dy) * k < 3) return
      d.moved = true
      let guides = [], gaps = []
      if (!e.altKey) {
        const movingRects = board.nodes.filter((n) => d.ids.has(n.id)).map((n) => ({ x: n.x + dx, y: n.y + dy, w: n.width, h: n.height }))
        const others = board.nodes.filter((n) => !d.ids.has(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }))
        if (movingRects.length && others.length) {
          const s = snapMove(boundsOf(movingRects), others, SNAP_PX / k)
          dx += s.dx; dy += s.dy; guides = s.guides; gaps = s.gaps
        }
      }
      // 拖到框上:高亮目标框并提示;从框里拖出:提示"将移出"。归属由几何决定,所以这里只是预览。
      // 缓冲带按屏幕像素计(缩放后手感一致);上一次的目标框传回去做迟滞,避免边界抖动
      const drop = calcDrop(board, d.roots, dx, dy, { slack: DROP_SLACK / k, slackOut: DROP_SLACK_OUT / k, prev: d.lastTarget ?? null })
      d.lastTarget = drop.target
      const dropGroup = drop.target
      const leaving = drop.leaving.filter((x) => x.groupId !== dropGroup).map((x) => x.groupId)
      d.drop = drop
      d.result = { dx, dy }
      // 拖到框上时框实时长大,装得下被拖元素(只增不缩、只向需要的方向扩)
      let grow = null
      if (dropGroup) {
        const frame = byId.get(dropGroup)
        const rects = board.nodes.filter((n) => d.ids.has(n.id) && n.type !== 'group').map((n) => ({ x: n.x + dx, y: n.y + dy, width: n.width, height: n.height }))
        const g = growFrameToFit(frame, rects, { bystanders: bystandersOf(board, frame, [...d.ids]) })
        if (g) grow = { id: dropGroup, ...g }
      }
      d.grow = grow
      setPreview({ dx, dy, ids: d.ids, guides, gaps, dropGroup, dropCount: drop.inside.length, leaving: new Set(leaving), grow })
    } else if (d.kind === 'unitResize') {
      const dx = (e.clientX - d.cx) / k, dy = (e.clientY - d.cy) / k
      const o = d.orig, hd = d.handle
      const MIN = 40
      let L = o.x, R = o.x + o.w, T = o.y, B = o.y + o.h
      if (hd.includes('w')) L = Math.min(o.x + dx, R - MIN)
      if (hd.includes('e')) R = Math.max(R + dx, L + MIN)
      if (hd.includes('n')) T = Math.min(o.y + dy, B - MIN)
      if (hd.includes('s')) B = Math.max(B + dy, T + MIN)
      // 角点:等比缩放(以宽度为准),与飞书/Figma 的"按住 Shift 等比"相反——组合默认等比更不易把图形压扁
      if (hd.length === 2 && !e.shiftKey) {
        const ratio = o.w / o.h
        const w = R - L, hgt = w / ratio
        if (hd.includes('n')) T = B - hgt; else B = T + hgt
      }
      const to = { x: L, y: T, w: R - L, h: B - T }
      const ops = scaleOps(d.nodes, o, to)
      d.result = ops
      setClusterScale({ map: Object.fromEntries(ops.map((op) => [op.id, op.patch])), rect: to })
    } else if (d.kind === 'resize') {
      const dx = (e.clientX - d.cx) / k, dy = (e.clientY - d.cy) / k
      const o = d.orig, hd = d.handle
      const MINW = 80, MINH = 48
      // 先得到每条边的目标位置(world),再吸附,最后换算回 x/y/width/height
      let L = o.x, R = o.x + o.width, T = o.y, B = o.y + o.height
      if (hd.includes('w')) L = Math.min(o.x + dx, R - MINW)
      if (hd.includes('e')) R = Math.max(R + dx, L + MINW)
      if (hd.includes('n')) T = Math.min(o.y + dy, B - MINH)
      if (hd.includes('s')) B = Math.max(B + dy, T + MINH)
      let guides = []
      if (!e.altKey) {
        // 只对被拖动的边做吸附:把它当成一个零宽/零高的"点"套用对齐算法
        const others = board.nodes.filter((n) => n.id !== d.id).map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }))
        const px = hd.includes('e') ? R : hd.includes('w') ? L : null
        const py = hd.includes('s') ? B : hd.includes('n') ? T : null
        const s = snapMove({ x: px ?? o.x, y: py ?? o.y, w: 0.001, h: 0.001 }, others, SNAP_PX / k)
        if (px !== null) { if (hd.includes('e')) R += s.dx; else L += s.dx }
        if (py !== null) { if (hd.includes('s')) B += s.dy; else T += s.dy }
        guides = s.guides.filter((g) => (g.axis === 'x' && px !== null && Math.abs(g.pos - (hd.includes('e') ? R : L)) < 0.5) || (g.axis === 'y' && py !== null && Math.abs(g.pos - (hd.includes('s') ? B : T)) < 0.5))
        R = Math.max(R, L + MINW); B = Math.max(B, T + MINH)
        L = Math.min(L, R - MINW); T = Math.min(T, B - MINH)
      }
      // 图片:四角等比缩放(以宽度为准)
      if (d.ratio && hd.length === 2) {
        const w = R - L, hgt = w / d.ratio
        if (hd.includes('n')) T = B - hgt; else B = T + hgt
      }
      d.result = { id: d.id, x: L, y: T, width: R - L, height: B - T }
      setResize(d.result)
      setPreview({ dx: 0, dy: 0, ids: new Set(), guides, gaps: [], dropGroup: null })
    } else if (d.kind === 'link' || d.kind === 'reconnect') {
      const w = toWorld(e.clientX, e.clientY)
      const near = nearestAnchor(board.nodes, w.x, w.y, 24 / k, d.fromId ?? d.fixedId)
      const over = near ? near.node : hitNode(layered(board.nodes), w.x, w.y, d.fromId ?? d.fixedId)
      d.target = near ? { id: near.node.id, side: near.side } : over ? { id: over.id, side: null } : null
      d.last = w
      setLinking((l) => l && { ...l, x: w.x, y: w.y, target: d.target })
    }
  }

  const onUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    try { rootRef.current.releasePointerCapture(e.pointerId) } catch { /* 已释放 */ }
    if (d.kind === 'bend') {
      setBendPreview(null)
      if (d.value !== undefined && d.value !== d.start0) store.dispatch([{ op: 'updateEdge', id: d.id, patch: { bend: d.value === 0 ? null : d.value } }])
      return
    }
    if (d.kind === 'place') { finishPlace(d, e.shiftKey); return }
    if (d.kind === 'marquee') setMarquee(null)
    if (d.kind === 'move' && d.moved && d.result) {
      // 只发一条 moveNodes:内核按集合去重(框 + 框内卡片 + 组合成员,每个节点恰好位移一次)。
      // 以前把框和卡片拆成两条 op,第二条会让已被框带走的卡片再移动一次。
      const ids = [...new Set(expandToUnits(board, d.roots, scope))]
      const ops = ids.length ? [{ op: 'moveNodes', ids, dx: d.result.dx, dy: d.result.dy }] : []
      // 目标框扩大与移动在同一批 ops 里:一次撤销同时还原卡片位置和框的大小
      if (ops.length && d.grow) { const { id, ...patch } = d.grow; ops.push({ op: 'updateNode', id, patch }) }
      if (ops.length) store.dispatch(ops)
    }
    if (d.kind === 'move') {
      setPreview(null)
      if (!d.moved && pendingCollapse.current) store.select(selectionUnitFor(board, byId.get(pendingCollapse.current), scope))
      pendingCollapse.current = null
    }
    if (d.kind === 'unitResize') {
      setClusterScale(null)
      if (d.result?.length) store.dispatch(d.result)
      return
    }
    if (d.kind === 'resize') {
      const r = d.result
      if (r) store.dispatch([{ op: 'updateNode', id: d.id, patch: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }])
      setResize(null)
      setPreview(null)
    }
    if (d.kind === 'link' || d.kind === 'reconnect') {
      const target = d.target ?? null
      const last = d.last
      setLinking(null)
      if (!target) {
        // 拖到空白处:新建卡片并连上(Heptabase 式快捷创建);没真正拖动过(只是点了一下圆点)则不创建
        if (d.kind === 'link' && last) createLinkedCard(d.fromId, d.fromSide, last)
        return
      }
      const toSide = target.side || undefined
      if (d.kind === 'link') {
        const bothShapes = byId.get(d.fromId)?.type === 'shape' && byId.get(target.id)?.type === 'shape'
        store.dispatch([{ op: 'addEdge', edge: { fromNode: d.fromId, fromSide: d.fromSide, toNode: target.id, ...(toSide ? { toSide } : {}), ...(bothShapes ? { route: 'orthogonal' } : {}) } }])
      } else {
        const e0 = d.edge
        const patch = d.end === 'from'
          ? { fromNode: target.id, fromSide: toSide ?? null }
          : { toNode: target.id, toSide: toSide ?? null }
        if (patch.fromNode === e0.toNode || patch.toNode === e0.fromNode) return
        store.dispatch([{ op: 'updateEdge', id: e0.id, patch }])
      }
    }
  }

  const createLinkedCard = (fromId, fromSide, pos) => {
    const from = byId.get(fromId)
    if (!from) return
    const W = 320, H = 200
    const x = fromSide === 'left' ? pos.x - W : fromSide === 'right' ? pos.x : pos.x - W / 2
    const y = fromSide === 'top' ? pos.y - H : fromSide === 'bottom' ? pos.y : pos.y - H / 2
    const id = 'n' + Math.random().toString(36).slice(2, 9)
    store.dispatch([
      { op: 'addNode', node: { id, type: 'text', x: Math.round(x), y: Math.round(y), width: W, height: H, text: '' } },
      { op: 'addEdge', edge: { fromNode: fromId, fromSide, toNode: id } },
    ])
    store.select([id])
    store.setEditing(id)
  }

  // 松手后若放在了框上/框外,调整归属 = 不需要任何数据变化(归属由几何决定),只是视觉高亮

  const onKeyUp = (e) => { if (e.code === 'Space') spaceDown.current = false }
  const isDragging = !!(preview || resize || linking || marquee)
  const onKeyDown = (e) => {
    if (e.code === 'Space' && !e.target.closest('input,textarea,[contenteditable=true]')) { spaceDown.current = true; e.preventDefault(); return }
    if (editing || e.target.closest('input,textarea,[contenteditable=true]')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearch?.(true); return }
    if (!mod && !e.altKey && setTool) {
      const k = e.key.toLowerCase()
      if (k === 'v') { setTool(null); return }
      if (k === 't') { setTool({ kind: 'text' }); return }
      if (k === 'n') { setTool({ kind: 'card' }); return }
      if (k === 'r') { setTool({ kind: 'shape', shape: 'rect' }); return }
      if (k === 'o') { setTool({ kind: 'shape', shape: 'ellipse' }); return }
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && (selection.length || edgeSelection)) {
      e.preventDefault()
      const ops = []
      if (edgeSelection) ops.push({ op: 'removeEdges', ids: [edgeSelection] })
      if (selection.length) ops.push({ op: 'removeNodes', ids: expandToUnits(board, selection, scope) })
      store.dispatch(ops)
      store.select([])
    } else if (mod && e.key.toLowerCase() === 'g' && selection.length) {
      e.preventDefault()
      const ops = e.shiftKey ? ungroupOps(board, selection, scope) : groupOps(board, selection, uid('c'), scope)
      if (ops.length) {
        store.dispatch(ops)
        // 组合后选中新组合的全部成员;取消后保持选中这些节点
        store.select(expandToUnits({ ...board, nodes: applyOpsLocal(board, ops) }, selection, scope))
      }
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.shiftKey ? store.redo() : store.undo()
    } else if (mod && e.key.toLowerCase() === 'd' && selection.length) {
      e.preventDefault()
      const { ops, ids } = pasteOps(parsePayload(copyPayload(board, expandToUnits(board, selection, scope))), { boardId: board.id, newId: uid })
      store.dispatch(ops); store.select(ids)
    } else if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x') && selection.length) {
      e.preventDefault()
      navigator.clipboard?.writeText(copyPayload(board, selection)).catch(() => {})
      if (e.key.toLowerCase() === 'x') {
        const inner = new Set(selection)
        for (const g of board.nodes) if (g.type === 'group' && inner.has(g.id)) for (const c of containedBy(board, g)) inner.add(c.id)
        store.dispatch([{ op: 'removeNodes', ids: [...inner] }]); store.select([])
      }
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      store.select(board.nodes.map((n) => n.id))
    } else if (e.key === 'Escape') {
      if (tool) { setTool?.(null); return }
      if (scope.length) { store.setScope(scope.slice(0, -1)); return }
      store.select([])
    } else if (e.key === 'Enter' && selection.length === 1 && selection[0] !== detailId && EDITABLE.has(byId.get(selection[0])?.type)) {
      e.preventDefault()
      store.setEditing(selection[0])
    } else if (e.key.startsWith('Arrow') && selection.length) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      store.dispatch([{ op: 'moveNodes', ids: expandToUnits(board, selection, scope), dx, dy }], { merge: 'nudge' })
    }
  }

  const onPaste = async (e) => {
    if (editing || e.target.closest('input,textarea,[contenteditable=true]')) return
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
    const raw = e.clipboardData?.getData('text/plain')
    const payload = parsePayload(raw)
    if (payload) {
      e.preventDefault()
      const { ops, ids } = pasteOps(payload, { boardId: board.id, at: viewCenter(), newId: uid })
      if (ops.length) { store.dispatch(ops); store.select(ids) }
      return
    }
    if (!files.length) {
      const text = raw
      if (text?.trim()) {
        e.preventDefault()
        const c = viewCenter()
        store.dispatch([{ op: 'addNode', node: { type: 'text', x: Math.round(c.x - 160), y: Math.round(c.y - 100), text } }])
      }
      return
    }
    e.preventDefault()
    await addImages(files, viewCenter())
  }

  const viewCenter = () => {
    const r = rootRef.current.getBoundingClientRect()
    return toWorld(r.left + r.width / 2, r.top + r.height / 2)
  }

  const addImages = async (files, at) => {
    let off = 0
    for (const f of files) {
      try {
        const file = await transport.uploadImage(board.id, f)
        const dim = await imageSize(f)
        const { width: w, height: hgt } = initialImageSize({ w: dim.w, h: dim.h })
        store.dispatch([{ op: 'addNode', node: { type: 'image', file, natural: { w: dim.w, h: dim.h }, x: Math.round(at.x - w / 2 + off), y: Math.round(at.y - hgt / 2 + off), width: w, height: hgt } }])
        off += 32
      } catch (err) { store.fail?.(err) }
    }
  }

  const replaceImage = async (file) => {
    const id = replaceTarget.current
    if (!id || !file) return
    try {
      const f = await transport.uploadImage(board.id, file)
      const dim = await imageSize(file)
      // 保持宽度,按新图比例重算高度(含说明区),natural 同步更新
      const n = byId.get(id)
      const hgt = Math.round((n.width * dim.h) / dim.w) + (n.caption ? 28 : 0)
      store.dispatch([{ op: 'updateNode', id, patch: { file: f, natural: { w: dim.w, h: dim.h }, height: hgt } }])
    } catch (err) { store.fail?.(err) }
  }

  const onDrop = async (e) => {
    const shapeKind = e.dataTransfer?.getData('application/x-wb-shape')
    if (shapeKind) {
      e.preventDefault()
      const w = toWorld(e.clientX, e.clientY)
      const [dw, dh] = SHAPE_DEFAULT_SIZE[shapeKind] || [160, 80]
      const id = uid('n')
      store.dispatch([{ op: 'addNode', node: { id, type: 'shape', kind: shapeKind, x: Math.round(w.x - dw / 2), y: Math.round(w.y - dh / 2), width: dw, height: dh, text: '' } }])
      store.select([id])
      return
    }
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    await addImages(files, toWorld(e.clientX, e.clientY))
  }

  // ---- 渲染 ----
  const selSet = new Set(selection)
  const linkFrom = linking && byId.get(linking.fromId)
  const canvas = h('div', {
    ref: rootRef, tabIndex: 0, className: 'wb-canvas' + (tool ? ' is-placing' : ''),
    onPointerDown: onBackgroundDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
    onKeyDown, onKeyUp, onPaste, onDragOver: (e) => e.preventDefault(), onDrop,
    'data-pan': undefined,
    style: { backgroundSize: `${24 * viewport.k}px ${24 * viewport.k}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` },
  },
    h('div', { className: 'wb-world', style: { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` } },
      // 框在最底层
      nodes.filter((n) => n.type === 'group').map((n0) => {
        const n = live(n0)
        return h(NodeView, {
          key: n.id, node: n, selected: selSet.has(n.id), multi: selection.length > 1 || clusterPath(n).length > scope.length, editing: editing === n.id, detailId, dropTarget: preview?.dropGroup === n.id, dropCount: preview?.dropCount, leaving: !!preview?.leaving?.has(n.id), memberCount: n.type === 'group' ? memberCount(board, n) : undefined,
          store, transport, boardId: board.id, t, hover: hoverId === n.id, onHover: setHoverId,
          onDown: onNodeDown, onResizeDown, onAnchorDown, linkTarget: linking?.target?.id === n.id,
        })
      }),
      // 连线在框之上、卡片之下
      h('svg', { className: 'wb-edges', width: 1, height: 1, style: { overflow: 'visible' } },
        h('defs', null,
          h('marker', { id: 'wb-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' },
            h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' })),
          h('marker', { id: 'wb-dot', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 6, markerHeight: 6 },
            h('circle', { cx: 5, cy: 5, r: 4, fill: 'context-stroke' }))),
        board.edges.map((ed) => {
          const f0 = byId.get(ed.fromNode), t0 = byId.get(ed.toNode)
          if (!f0 || !t0) return null
          const g = edgeGeometry(bendPreview?.id === ed.id ? { ...ed, bend: bendPreview.bend } : ed, live(f0), live(t0))
          const sel = edgeSelection === ed.id
          const color = ed.color && COLORS[ed.color] ? shapeStroke(ed.color) : 'var(--wb-edge)'
          return h('g', { key: ed.id, 'data-wb-edge': ed.id, className: 'wb-edge' + (sel ? ' is-selected' : '') },
            h('path', { d: g.d, className: 'wb-edge-hit', onPointerDown: (e) => { e.stopPropagation(); rootRef.current.focus(); store.select([], ed.id) }, onDoubleClick: (e) => { e.stopPropagation(); setEdgeEdit(ed.id) } }),
            (() => { const en = edgeEnds(ed); const mk = (s) => (s === 'arrow' ? 'url(#wb-arrow)' : s === 'dot' ? 'url(#wb-dot)' : undefined)
              return h('path', { d: g.d, className: 'wb-edge-line', stroke: color, strokeLinejoin: 'round', strokeDasharray: ed.dashed ? '6 5' : undefined, markerEnd: mk(en.end), markerStart: mk(en.start), style: { color } }) })(),
            ed.label && edgeEdit !== ed.id ? h(EdgeLabel, { x: g.mid.x, y: g.mid.y, text: ed.label, onDoubleClick: () => setEdgeEdit(ed.id), onDown: (e) => { e.stopPropagation(); store.select([], ed.id) } }) : null,
            edgeEdit === ed.id ? h(EdgeLabelEditor, { x: g.mid.x, y: g.mid.y, value: ed.label || '', onDone: (v) => { setEdgeEdit(null); if (v !== (ed.label || '')) store.dispatch([{ op: 'updateEdge', id: ed.id, patch: { label: v || null } }]) } }) : null,
            null)
        }),
        // 正在拉的线(新建连线或改接端点)
        linking && linkFrom ? (() => {
          const tg = linking.target && byId.get(linking.target.id)
          const free = { x: linking.x, y: linking.y }
          const fixedPt = anchorPoint(live(linkFrom), linking.fromSide)
          // 悬停在节点上但还没吸附到连接点:预览先贴到最近的一边,看起来就是"会连到那里"
          const side = tg ? (linking.target.side || autoSide(tg, live(linkFrom))) : undefined
          const movingPt = tg ? anchorPoint(tg, side) : free
          const [a, as, b, bs] = linking.reversed ? [movingPt, side, fixedPt, linking.fromSide] : [fixedPt, linking.fromSide, movingPt, side]
          const route = drag.current?.edge?.route
          const g = route === 'straight' ? straightBetween(a, as, b, bs) : pathBetween(a, as, b, bs)
          return h('path', { d: g.d, className: 'wb-edge-line is-ghost', markerEnd: 'url(#wb-arrow)' })
        })() : null),
      nodes.filter((n) => n.type !== 'group').map((n0) => {
        const n = live(n0)
        return h(NodeView, {
          key: n.id, node: n, selected: selSet.has(n.id), multi: selection.length > 1 || clusterPath(n).length > scope.length, editing: editing === n.id, detailId,
          store, transport, boardId: board.id, t, hover: hoverId === n.id, onHover: setHoverId,
          onDown: onNodeDown, onResizeDown, onAnchorDown, onQuickAdd: quickAdd, linkTarget: linking?.target?.id === n.id, linkSide: linking?.target?.id === n.id ? linking.target.side : null,
        })
      }),
      // 选中了组合(或多选)时:整体外包盒 + 缩放手柄。单个非组合节点用它自己的手柄,这里不画。
      (() => {
        if (editing || selection.length < 1 || edgeSelection) return null
        const sel = board.nodes.filter((n) => selection.includes(n.id))
        const isCluster = sel.some((n) => clusterPath(n).length > scope.length)
        if (!isCluster && sel.length < 2) return null
        if (preview) return null
        const nodesNow = sel.map(live)
        const r = clusterScale?.rect ? { x: clusterScale.rect.x, y: clusterScale.rect.y, w: clusterScale.rect.w, h: clusterScale.rect.h } : clusterBounds(nodesNow)
        const hs = 10 / viewport.k, pad = 4 / viewport.k
        const pts = { nw: [r.x, r.y], n: [r.x + r.w / 2, r.y], ne: [r.x + r.w, r.y], e: [r.x + r.w, r.y + r.h / 2], se: [r.x + r.w, r.y + r.h], s: [r.x + r.w / 2, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, r.y + r.h / 2] }
        const orig = clusterBounds(sel)
        return h('div', { className: 'wb-unitbox', 'data-wb-ui': true, style: { left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, borderWidth: 1.5 / viewport.k } },
          // 只有组合才给缩放手柄(多选的松散节点缩放没有明确语义)
          isCluster ? Object.entries(pts).map(([k2, [px, py]]) => h('div', {
            key: k2, 'data-wb-unit-handle': k2, className: 'wb-unit-handle wb-unit-handle-' + k2,
            style: { left: px - r.x + pad - hs / 2, top: py - r.y + pad - hs / 2, width: hs, height: hs },
            onPointerDown: (e) => onUnitResizeDown(e, k2, orig, sel),
          })) : null)
      })(),
      // 选中连线的手柄:必须在所有节点之上,否则贴着节点边缘的端点会被节点盖住点不到
      edgeSelection ? (() => {
        const ed = board.edges.find((x) => x.id === edgeSelection)
        const f0 = ed && byId.get(ed.fromNode), t0 = ed && byId.get(ed.toNode)
        if (!ed || !f0 || !t0) return null
        const g = edgeGeometry(bendPreview?.id === ed.id ? { ...ed, bend: bendPreview.bend } : ed, live(f0), live(t0))
        const r = 7 / viewport.k
        const bendAxis = g.handle?.axis
        return h('svg', { className: 'wb-edge-handles', width: 1, height: 1, style: { overflow: 'visible' }, 'data-wb-ui': true },
          g.handle ? h('g', { className: 'wb-edge-bend', transform: `translate(${g.handle.x} ${g.handle.y})`, 'data-wb-bend': bendAxis, onPointerDown: (e) => onBendDown(e, ed, g) },
            h('rect', { x: -(bendAxis === 'x' ? 4 : 11) / viewport.k, y: -(bendAxis === 'x' ? 11 : 4) / viewport.k, width: (bendAxis === 'x' ? 8 : 22) / viewport.k, height: (bendAxis === 'x' ? 22 : 8) / viewport.k, rx: 4 / viewport.k })) : null,
          h('circle', { cx: g.a.x, cy: g.a.y, r, className: 'wb-edge-end', 'data-wb-edge-end': 'from', onPointerDown: (e) => onEdgeEndDown(e, ed, 'from') }),
          h('circle', { cx: g.b.x, cy: g.b.y, r, className: 'wb-edge-end', 'data-wb-edge-end': 'to', onPointerDown: (e) => onEdgeEndDown(e, ed, 'to') }),
          !ed.label && !g.handle ? h('g', { className: 'wb-edge-addlabel', transform: `translate(${g.mid.x} ${g.mid.y})`, onPointerDown: (e) => { e.stopPropagation(); setEdgeEdit(ed.id) } },
            h('circle', { r: 9 / viewport.k }), h('text', { textAnchor: 'middle', dy: '0.35em', fontSize: 12 / viewport.k }, 'T')) : null)
      })() : null,
      // 对齐线与间距
      preview ? h(Guides, { guides: preview.guides, gaps: preview.gaps, k: viewport.k }) : null,
      marquee ? h('div', { className: 'wb-marquee', style: { left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h } }) : null,
      placing ? h('div', { className: 'wb-placing', style: { left: placing.x, top: placing.y, width: placing.w, height: placing.h } }) : null,
    ),
    board.nodes.length === 0 ? h('div', { className: 'wb-empty' }, t('canvas.empty')) : null,
  )
  return h('div', { ref: stageRef, className: 'wb-canvas-host' },
    canvas,
    setTool ? h(LeftToolbar, {
      tool, setTool, t, onAddGroup: () => addGroupAtCenter(),
      onAddImage: () => addFileRef.current?.click(),
      onAddHtml: () => addHtmlAtCenter(),
      onUndo: store.undo, onRedo: store.redo, onFit: () => fitView(),
      canUndo: state.canUndo, canRedo: state.canRedo,
    }) : null,
    h('input', { ref: addFileRef, type: 'file', accept: 'image/*', multiple: true, hidden: true, 'data-wb-ui': true, 'data-wb-add-image': true,
      onChange: (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addImages(fs, viewCenter()) } }),
    h(ContextBar, { store, state, size, t, dragging: isDragging, transport,
      onReplaceImage: (n) => { replaceTarget.current = n.id; replaceRef.current?.click() },
      onPreview: (n) => setPreviewImg({ src: transport.assetUrl(board.id, n.file), alt: n.caption || n.title }) }),
    h('input', { ref: replaceRef, type: 'file', accept: 'image/*', hidden: true, 'data-wb-ui': true, 'data-wb-replace-image': true, onChange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; replaceImage(f) } }),
    preview_ ? h(Lightbox, { src: preview_.src, alt: preview_.alt, onClose: () => setPreviewImg(null) }) : null,
    search ? h(SearchBox, { store, state, size, t, onClose: () => { setSearch(false); rootRef.current?.focus() } }) : null,
    h(Minimap, { store, state, size, t }))
}

function Guides({ guides, gaps, k }) {
  const sw = 1 / k
  return h('svg', { className: 'wb-guides', width: 1, height: 1, style: { overflow: 'visible' } },
    guides.map((g, i) => g.axis === 'x'
      ? h('line', { key: 'g' + i, x1: g.pos, x2: g.pos, y1: g.from - 12, y2: g.to + 12, className: 'wb-guide', strokeWidth: sw })
      : h('line', { key: 'g' + i, y1: g.pos, y2: g.pos, x1: g.from - 12, x2: g.to + 12, className: 'wb-guide', strokeWidth: sw })),
    gaps.map((g, i) => {
      const label = String(g.value)
      const fs = 11 / k
      if (g.axis === 'x') {
        return h('g', { key: 'p' + i, className: 'wb-gap' },
          h('line', { x1: g.from, x2: g.to, y1: g.cross, y2: g.cross, strokeWidth: sw }),
          h('line', { x1: g.from, x2: g.from, y1: g.cross - 4 / k, y2: g.cross + 4 / k, strokeWidth: sw }),
          h('line', { x1: g.to, x2: g.to, y1: g.cross - 4 / k, y2: g.cross + 4 / k, strokeWidth: sw }),
          h('rect', { x: (g.from + g.to) / 2 - 12 / k, y: g.cross - 16 / k, width: 24 / k, height: 14 / k, rx: 3 / k }),
          h('text', { x: (g.from + g.to) / 2, y: g.cross - 9 / k, fontSize: fs, textAnchor: 'middle', dy: '0.35em' }, label))
      }
      return h('g', { key: 'p' + i, className: 'wb-gap' },
        h('line', { y1: g.from, y2: g.to, x1: g.cross, x2: g.cross, strokeWidth: sw }),
        h('line', { y1: g.from, y2: g.from, x1: g.cross - 4 / k, x2: g.cross + 4 / k, strokeWidth: sw }),
        h('line', { y1: g.to, y2: g.to, x1: g.cross - 4 / k, x2: g.cross + 4 / k, strokeWidth: sw }),
        h('rect', { y: (g.from + g.to) / 2 - 7 / k, x: g.cross + 4 / k, width: 24 / k, height: 14 / k, rx: 3 / k }),
        h('text', { y: (g.from + g.to) / 2, x: g.cross + 16 / k, fontSize: fs, textAnchor: 'middle', dy: '0.35em' }, label))
    }))
}

function EdgeLabel({ x, y, text, onDoubleClick, onDown }) {
  // foreignObject 里放 div,保证文字可换行并带底色遮住线
  return h('foreignObject', { x: x - 100, y: y - 14, width: 200, height: 28, style: { overflow: 'visible', pointerEvents: 'none' } },
    h('div', { className: 'wb-edge-labelwrap' },
      h('span', { className: 'wb-edge-label', onDoubleClick, onPointerDown: onDown, style: { pointerEvents: 'auto' } }, text)))
}

function EdgeLabelEditor({ x, y, value, onDone }) {
  const ref = React.useRef(null)
  React.useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return h('foreignObject', { x: x - 100, y: y - 14, width: 200, height: 28, 'data-wb-ui': true },
    h('div', { className: 'wb-edge-labelwrap' },
      h('input', {
        ref, defaultValue: value, className: 'wb-edge-input',
        onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') onDone(e.currentTarget.value.trim()); if (e.key === 'Escape') onDone(value) },
        onBlur: (e) => onDone(e.currentTarget.value.trim()),
        onPointerDown: (e) => e.stopPropagation(),
      })))
}

/** 把 updateNode ops 套在节点数组上(只用于预估新选择,不入库)。 */
function applyOpsLocal(board, ops) {
  const patch = new Map(ops.map((o) => [o.id, o.patch]))
  return board.nodes.map((n) => { const p = patch.get(n.id); if (!p) return n; const m = { ...n, ...p }; for (const k of Object.keys(m)) if (m[k] === null) delete m[k]; return m })
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function imageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 200 }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({ w: 320, h: 200 }); URL.revokeObjectURL(url) }
    img.src = url
  })
}

export { SIDES }
