import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ICONS } from '../src/client/icons.js'

// 解析图标里的 <line>/<rect>,验证几何与它声称的语义一致
const parse = (name) => {
  const html = renderToStaticMarkup(ICONS[name]())
  const attr = (tag, a) => [...html.matchAll(new RegExp(`<${tag}[^>]*?${a}="([^"]+)"`, 'g'))].map((m) => Number(m[1]))
  const attrs = (src) => Object.fromEntries([...src.matchAll(/([\w-]+)="([^"]+)"/g)].map(([, k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)]))
  const rects = [...html.matchAll(/<rect ([^>]*?)\/?>/g)].map((m) => attrs(m[1]))
  const lines = [...html.matchAll(/<line ([^>]*?)\/?>/g)].map((m) => attrs(m[1]))
  return { rects: rects.filter((r) => r['fill-opacity']), lines, html }
}

test('每个图标都是 16×16、描边 currentColor,没有文字', () => {
  for (const name of Object.keys(ICONS)) {
    const { html } = parse(name)
    assert.match(html, /viewBox="0 0 16 16"/, name)
    assert.match(html, /stroke="currentColor"/, name)
    assert.doesNotMatch(html, /<text/, name)
  }
})

test('左/右对齐:两个块的一侧边缘与参考线重合(或紧贴),另一侧长短不一', () => {
  const l = parse('left'), r = parse('right')
  const lineX = (p) => p.lines[0].x1
  assert.ok(l.rects.every((b) => Math.abs(b.x - lineX(l)) <= 2.2), 'left')
  assert.ok(r.rects.every((b) => Math.abs(b.x + b.width - lineX(r)) <= 2.2), 'right')
  assert.notEqual(l.rects[0].width, l.rects[1].width)
  assert.notEqual(r.rects[0].width, r.rects[1].width)
})

test('顶/底对齐:两个块的上/下沿贴着参考横线,高度不一', () => {
  const t = parse('top'), b = parse('bottom')
  assert.ok(t.rects.every((r) => Math.abs(r.y - t.lines[0].y1) <= 2.2), 'top')
  assert.ok(b.rects.every((r) => Math.abs(r.y + r.height - b.lines[0].y1) <= 2.2), 'bottom')
  assert.notEqual(t.rects[0].height, t.rects[1].height)
})

test('居中对齐:两个块的中心都落在参考线上', () => {
  const h = parse('hcenter'), v = parse('vcenter')
  for (const r of h.rects) assert.ok(Math.abs(r.x + r.width / 2 - h.lines[0].x1) < 0.01, 'hcenter')
  for (const r of v.rects) assert.ok(Math.abs(r.y + r.height / 2 - v.lines[0].y1) < 0.01, 'vcenter')
})

test('分布:两端各有一根线、中间的块在正中,两侧间隔标记对称', () => {
  const dx = parse('distX'), dy = parse('distY')
  const [a, b] = dx.lines
  assert.ok(Math.abs((a.x1 + b.x1) / 2 - (dx.rects[0].x + dx.rects[0].width / 2)) < 0.01)
  const [c, d] = dy.lines
  assert.ok(Math.abs((c.y1 + d.y1) / 2 - (dy.rects[0].y + dy.rects[0].height / 2)) < 0.01)
})

test('图标元素都在 16×16 画布内', () => {
  for (const name of Object.keys(ICONS)) {
    const { rects, lines } = parse(name)
    for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 16 && r.y + r.height <= 16, `${name} rect`)
    for (const l of lines) assert.ok([l.x1, l.x2, l.y1, l.y2].every((n) => n >= 0 && n <= 16), `${name} line`)
  }
})
