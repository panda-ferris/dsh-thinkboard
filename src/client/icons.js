// 工具条图标:统一 16×16、描边 currentColor,随主题着色。
// 对齐图标的语义:一条参考线 + 两个长短不一的块贴着它(或居中于它),一眼能看出对齐到哪一侧。

import React from 'react'

const h = React.createElement

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const svg = (...children) => h('svg', base, ...children)
const line = (x1, y1, x2, y2) => h('line', { x1, y1, x2, y2 })
const block = (x, y, w, hgt) => h('rect', { x, y, width: w, height: hgt, rx: 1, fill: 'currentColor', fillOpacity: 0.28 })

export const ICONS = {
  // 竖线在左,两个块左边贴线
  left: () => svg(line(2, 1.5, 2, 14.5), block(4, 3.5, 9, 3.5), block(4, 9, 5.5, 3.5)),
  // 竖线居中,两个块以它为轴
  hcenter: () => svg(line(8, 1.5, 8, 14.5), block(2.5, 3.5, 11, 3.5), block(4.5, 9, 7, 3.5)),
  right: () => svg(line(14, 1.5, 14, 14.5), block(3, 3.5, 9, 3.5), block(6.5, 9, 5.5, 3.5)),
  // 横线在上
  top: () => svg(line(1.5, 2, 14.5, 2), block(3.5, 4, 3.5, 9), block(9, 4, 3.5, 5.5)),
  vcenter: () => svg(line(1.5, 8, 14.5, 8), block(3.5, 2.5, 3.5, 11), block(9, 4.5, 3.5, 7)),
  bottom: () => svg(line(1.5, 14, 14.5, 14), block(3.5, 3, 3.5, 9), block(9, 6.5, 3.5, 5.5)),
  // 等间距:两端各一根竖/横线,中间一个块,两侧用双向小箭头表示间隔相等
  distX: () => svg(line(1.5, 2, 1.5, 14), line(14.5, 2, 14.5, 14), block(6.2, 4.5, 3.6, 7), line(3, 8, 5.6, 8), line(10.4, 8, 13, 8)),
  distY: () => svg(line(2, 1.5, 14, 1.5), line(2, 14.5, 14, 14.5), block(4.5, 6.2, 7, 3.6), line(8, 3, 8, 5.6), line(8, 10.4, 8, 13)),
  // 成框:虚线框里一个块
  wrap: () => svg(h('rect', { x: 1.8, y: 2.8, width: 12.4, height: 10.4, rx: 2, strokeDasharray: '2.2 1.8' }), block(5, 6, 6, 4)),
  search: () => svg(h('circle', { cx: 7, cy: 7, r: 4.2 }), line(10.2, 10.2, 14, 14)),
  trash: () => svg(line(2.5, 4, 13.5, 4), h('path', { d: 'M6 4V2.6h4V4' }), h('path', { d: 'M4 4l.7 9.4h6.6L12 4' }), line(6.7, 6.5, 6.9, 11), line(9.3, 6.5, 9.1, 11)),
  replace: () => svg(h('path', { d: 'M2.5 6.5a5.5 5.5 0 0 1 9.4-2.6L13.5 5.5' }), h('path', { d: 'M13.5 2.5v3h-3' }), h('path', { d: 'M13.5 9.5a5.5 5.5 0 0 1-9.4 2.6L2.5 10.5' }), h('path', { d: 'M2.5 13.5v-3h3' })),
  ratio: () => svg(h('rect', { x: 2, y: 4, width: 12, height: 8, rx: 1.5 }), h('path', { d: 'M5 9.5l2-2.2 1.6 1.7 1.2-1.2 1.8 1.7' })),
  expand: () => svg(h('path', { d: 'M9.5 2.5h4v4' }), h('path', { d: 'M6.5 13.5h-4v-4' }), line(13.5, 2.5, 9, 7), line(2.5, 13.5, 7, 9)),
  caption: () => svg(h('rect', { x: 2, y: 2.5, width: 12, height: 8, rx: 1.5 }), line(4.5, 13.2, 11.5, 13.2)),
  html: () => svg(h('path', { d: 'M5.5 4.5L2 8l3.5 3.5' }), h('path', { d: 'M10.5 4.5L14 8l-3.5 3.5' }), line(9, 3, 7, 13)),
  detail: () => svg(h('rect', { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }), line(9.5, 2.5, 9.5, 13.5), line(4, 6, 7.5, 6), line(4, 8.5, 7.5, 8.5)),
  fold: () => svg(h('path', { d: 'M4 6.5L8 3l4 3.5' }), h('path', { d: 'M4 13L8 9.5l4 3.5' })),
  unfold: () => svg(h('path', { d: 'M4 3l4 3.5L12 3' }), h('path', { d: 'M4 9.5L8 13l4-3.5' })),
  'route-curve': () => svg(h('path', { d: 'M2.5 13C2.5 6 13.5 10 13.5 3' }), h('circle', { cx: 13.5, cy: 3, r: 1, fill: 'currentColor' })),
  'route-orthogonal': () => svg(h('path', { d: 'M2.5 13V8h11V3' }), h('circle', { cx: 13.5, cy: 3, r: 1, fill: 'currentColor' })),
  'route-straight': () => svg(line(2.5, 13, 13.5, 3), h('circle', { cx: 13.5, cy: 3, r: 1, fill: 'currentColor' })),
  ends: () => svg(line(2.5, 8, 13, 8), h('path', { d: 'M10 5l3.5 3-3.5 3' }), h('circle', { cx: 3, cy: 8, r: 1.4, fill: 'currentColor' })),
  cluster: () => svg(h('rect', { x: 2, y: 2, width: 7, height: 6, rx: 1 }), h('rect', { x: 7, y: 8, width: 7, height: 6, rx: 1 }), h('path', { d: 'M1 1h14v14H1z', strokeDasharray: '2 1.8', opacity: 0.55 })),
  uncluster: () => svg(h('rect', { x: 1.5, y: 1.5, width: 6, height: 5, rx: 1 }), h('rect', { x: 8.5, y: 9.5, width: 6, height: 5, rx: 1 }), line(9, 4, 14, 4), line(2, 12, 7, 12)),
  map: () => svg(h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 1.5 }), h('rect', { x: 8, y: 6, width: 4.5, height: 4, rx: 0.8 }), h('path', { d: 'M4 5.5h2M4 8h2M4 10.5h2' })),
  fit: () => svg(h('rect', { x: 1.8, y: 2.8, width: 12.4, height: 10.4, rx: 2 }), block(5, 6, 6, 4), line(1.5, 1.5, 4, 1.5), line(12, 14.5, 14.5, 14.5)),
}

export function Icon({ name }) {
  const f = ICONS[name]
  return f ? f() : null
}
