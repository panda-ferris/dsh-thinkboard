// 图形库:每种图形在 w×h 的盒子里生成 SVG 路径与文字区域。纯函数。
//
// 每种图形显式给出 top/right/bottom/left 四个连接点(shapeAnchors),
// 测试保证这些点都落在图形轮廓上 —— 连线因此总是贴着图形边缘,而不是悬在外包盒上。

export const SHAPE_KINDS = [
  'rect', 'roundRect', 'ellipse', 'diamond', 'parallelogram',
  'trapezoid', 'cylinder', 'document', 'terminator', 'triangle',
  'hexagon', 'pentagon', 'star', 'arrowRight', 'bubble',
]

// 默认尺寸(流程图常用比例)
export const SHAPE_DEFAULT_SIZE = {
  rect: [160, 80], roundRect: [160, 80], ellipse: [140, 90], diamond: [160, 100], parallelogram: [170, 80],
  trapezoid: [170, 80], cylinder: [120, 110], document: [160, 90], terminator: [160, 64], triangle: [120, 100],
  hexagon: [160, 90], pentagon: [120, 110], star: [120, 120], arrowRight: [160, 90], bubble: [160, 100],
}

const f = (n) => Math.round(n * 100) / 100
const poly = (pts) => 'M ' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ') + ' Z'

/**
 * 返回 { d, text }:
 *   d    —— 轮廓路径(局部坐标,原点在盒子左上角)
 *   text —— 文字区 {x,y,w,h}(局部坐标),文字在其中居中换行
 *   extra(可选)—— 额外的装饰线(例如圆柱的顶面弧线),不填充
 */
export function shapeGeometry(kind, w, h) {
  const W = Math.max(1, w), H = Math.max(1, h)
  const cx = W / 2, cy = H / 2
  const pad = (l, t, r, b) => ({ x: l, y: t, w: Math.max(1, W - l - r), h: Math.max(1, H - t - b) })
  switch (kind) {
    case 'roundRect': {
      const r = Math.min(12, W / 4, H / 4)
      return {
        d: `M ${r} 0 H ${f(W - r)} A ${r} ${r} 0 0 1 ${f(W)} ${r} V ${f(H - r)} A ${r} ${r} 0 0 1 ${f(W - r)} ${f(H)} H ${r} A ${r} ${r} 0 0 1 0 ${f(H - r)} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
        text: pad(8, 6, 8, 6),
      }
    }
    case 'ellipse':
      return { d: `M 0 ${f(cy)} A ${f(cx)} ${f(cy)} 0 1 1 ${f(W)} ${f(cy)} A ${f(cx)} ${f(cy)} 0 1 1 0 ${f(cy)} Z`, text: pad(W * 0.15, H * 0.15, W * 0.15, H * 0.15) }
    case 'diamond':
      return { d: poly([[cx, 0], [W, cy], [cx, H], [0, cy]]), text: pad(W * 0.25, H * 0.25, W * 0.25, H * 0.25) }
    case 'parallelogram': {
      // 斜边经过上/下边中点之外的位置,左右中点在斜边上
      const k = Math.min(W * 0.2, H * 0.6)
      return { d: poly([[k, 0], [W, 0], [W - k, H], [0, H]]), text: pad(k, 4, k, 4) }
    }
    case 'trapezoid': {
      const k = Math.min(W * 0.2, H * 0.6)
      return { d: poly([[k, 0], [W - k, 0], [W, H], [0, H]]), text: pad(k * 0.8, 4, k * 0.8, 4) }
    }
    case 'cylinder': {
      const ry = Math.min(H * 0.15, 18)
      return {
        // 顶面椭圆的最高点在 y=0(上中点);底面弧的最低点在 y=H(下中点)
        d: `M 0 ${f(ry)} A ${f(cx)} ${f(ry)} 0 0 1 ${f(W)} ${f(ry)} V ${f(H - ry)} A ${f(cx)} ${f(ry)} 0 0 1 0 ${f(H - ry)} Z`,
        extra: `M 0 ${f(ry)} A ${f(cx)} ${f(ry)} 0 0 0 ${f(W)} ${f(ry)}`,
        text: pad(6, ry * 2 + 2, 6, ry + 2),
      }
    }
    case 'document': {
      // 下边是一段 S 形波浪:从右侧 (W, H-a) 降到中点 (cx, H),再升回左侧 (0, H-a)。
      // 控制点的 y 都不超过 H,保证曲线不画出外包盒;中点处切线水平,y 正好等于 H(下中点)。
      const a = Math.min(H * 0.12, 12)
      return {
        d: `M 0 0 H ${f(W)} V ${f(H - a)} C ${f(W * 0.8)} ${f(H - a * 1.8)}, ${f(W * 0.65)} ${f(H)}, ${f(cx)} ${f(H)} C ${f(W * 0.35)} ${f(H)}, ${f(W * 0.2)} ${f(H - a * 0.2)}, 0 ${f(H - a)} Z`,
        text: pad(8, 6, 8, a + 6),
      }
    }
    case 'terminator': {
      const r = H / 2
      return { d: `M ${f(r)} 0 H ${f(W - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(W - r)} ${f(H)} H ${f(r)} A ${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`, text: pad(r * 0.6, 4, r * 0.6, 4) }
    }
    case 'triangle':
      // 顶点在上中点;左右中点在两条斜边上;底边经过下中点
      return { d: poly([[cx, 0], [W, H], [0, H]]), text: pad(W * 0.25, H * 0.45, W * 0.25, 4) }
    case 'hexagon': {
      const k = Math.min(W * 0.22, H * 0.5)
      return { d: poly([[k, 0], [W - k, 0], [W, cy], [W - k, H], [k, H], [0, cy]]), text: pad(k * 0.7, 4, k * 0.7, 4) }
    }
    case 'pentagon':
      // 顶点在上中点;左右"肩"在 y=cy 处,使左右中点落在轮廓上
      return { d: poly([[cx, 0], [W, cy], [W * 0.8, H], [W * 0.2, H], [0, cy]]), text: pad(W * 0.2, H * 0.35, W * 0.2, 6) }
    case 'star': {
      // 五角星:外点在上中点;为保证左右中点、下中点也在轮廓上,补充经过这三点的边
      const pts = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 1 : 0.42
        pts.push([cx + Math.cos(ang) * cx * r, cy + Math.sin(ang) * cy * r])
      }
      return { d: poly(pts), text: pad(W * 0.3, H * 0.35, W * 0.3, H * 0.3) }
    }
    case 'arrowRight': {
      const head = Math.min(W * 0.35, H * 0.8)
      const shaft = H * 0.25
      return { d: poly([[0, shaft], [W - head, shaft], [W - head, 0], [W, cy], [W - head, H], [W - head, H - shaft], [0, H - shaft]]), text: pad(6, shaft + 2, head * 0.7, shaft + 2) }
    }
    case 'bubble': {
      // 圆角矩形 + 左下角小尾巴;主体占满宽、上 80% 高
      const bh = H * 0.82, r = Math.min(12, W / 4, bh / 4)
      return {
        d: `M ${r} 0 H ${f(W - r)} A ${r} ${r} 0 0 1 ${f(W)} ${r} V ${f(bh - r)} A ${r} ${r} 0 0 1 ${f(W - r)} ${f(bh)} H ${f(W * 0.36)} L ${f(W * 0.2)} ${f(H)} L ${f(W * 0.24)} ${f(bh)} H ${r} A ${r} ${r} 0 0 1 0 ${f(bh - r)} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
        text: pad(8, 6, 8, H - bh + 6),
      }
    }
    case 'rect':
    default:
      return { d: `M 0 0 H ${f(W)} V ${f(H)} H 0 Z`, text: pad(8, 6, 8, 6) }
  }
}

export const isShapeKind = (k) => SHAPE_KINDS.includes(k) || k === 'text'

/** 四个连接点(局部坐标)。都在轮廓上(测试验证)。 */
export function shapeAnchors(kind, w, h) {
  const W = Math.max(1, w), H = Math.max(1, h), cx = W / 2, cy = H / 2
  const mid = { top: { x: cx, y: 0 }, right: { x: W, y: cy }, bottom: { x: cx, y: H }, left: { x: 0, y: cy } }
  switch (kind) {
    case 'parallelogram': case 'trapezoid': {
      const k = Math.min(W * 0.2, H * 0.6)
      // 斜边在 y=cy 处的 x:平行四边形左边 (0,H)→(k,0),右边 (W,0)→(W-k,H);梯形左 (0,H)→(k,0),右 (W-k,0)→(W,H)
      return { ...mid, left: { x: k / 2, y: cy }, right: { x: W - k / 2, y: cy } }
    }
    case 'triangle':
      return { ...mid, left: { x: W / 4, y: cy }, right: { x: (W * 3) / 4, y: cy } }
    case 'star': {
      const pt = (deg, r) => ({ x: cx + Math.cos((deg * Math.PI) / 180) * cx * r, y: cy + Math.sin((deg * Math.PI) / 180) * cy * r })
      return { top: pt(-90, 1), right: pt(-18, 1), left: pt(198, 1), bottom: pt(90, 0.42) }
    }
    case 'arrowRight': {
      const head = Math.min(W * 0.35, H * 0.8), shaft = H * 0.25
      const onShaft = cx <= W - head
      return { ...mid, top: { x: onShaft ? cx : W - head, y: onShaft ? shaft : 0 }, bottom: { x: onShaft ? cx : W - head, y: onShaft ? H - shaft : H } }
    }
    case 'bubble': {
      const bh = H * 0.82
      return { top: { x: cx, y: 0 }, right: { x: W, y: bh / 2 }, bottom: { x: cx, y: bh }, left: { x: 0, y: bh / 2 } }
    }
    default:
      return mid
  }
}

// ---------------- 图形样式 ----------------
export const SHAPE_STYLE_DEFAULTS = { fill: 'none', stroke: 'default', strokeWidth: 1.5, dash: 'solid', fontSize: 14, align: 'center' }
export const DASHES = { solid: undefined, dashed: '7 5', dotted: '1.5 4' }
export const FONT_SIZES = [12, 14, 16, 20, 24, 32]

// ---------------- 四向快速生成 ----------------
/**
 * 从 src 图形朝 dir 方向生成一个同类(或指定类)的新图形,并连线。
 * 新图形中心与 src 对齐;间距 gap。若目标位置与已有元素重叠,沿生成方向继续推开,最多推 8 次。
 * 返回 { node, edge }(都未分配 id;调用方补 id 后走 ops)。
 */
export function quickAddPlan(board, src, dir, { gap = 60, kind } = {}) {
  const k = kind || src.kind || 'rect'
  const [dw, dh] = src.type === 'shape' && (!kind || kind === src.kind) ? [src.width, src.height] : (SHAPE_DEFAULT_SIZE[k] || [160, 80])
  const vec = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] }[dir]
  if (!vec) throw new Error(`bad direction "${dir}"`)
  const scx = src.x + src.width / 2, scy = src.y + src.height / 2
  let cx = scx + vec[0] * (src.width / 2 + gap + dw / 2)
  let cy = scy + vec[1] * (src.height / 2 + gap + dh / 2)
  const overlaps = (x, y) => board.nodes.some((n) => n.type !== 'group' && n.id !== src.id &&
    x - dw / 2 < n.x + n.width && x + dw / 2 > n.x && y - dh / 2 < n.y + n.height && y + dh / 2 > n.y)
  for (let i = 0; i < 8 && overlaps(cx, cy); i++) {
    // 朝生成方向的垂直方向错开,避免压住已有的分支
    if (vec[0] !== 0) cy += dh + gap / 2
    else cx += dw + gap / 2
  }
  const opp = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' }[dir]
  const node = { type: 'shape', kind: k, x: Math.round(cx - dw / 2), y: Math.round(cy - dh / 2), width: dw, height: dh, text: '' }
  for (const key of ['fill', 'stroke', 'strokeWidth', 'dash', 'fontSize']) if (src[key] !== undefined) node[key] = src[key]
  return { node, edge: { fromSide: dir, toSide: opp, route: 'orthogonal' } }
}
