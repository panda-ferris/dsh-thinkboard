import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { imageDimensions } from '../src/host/imagesize.js'
import { BoardStore } from '../src/host/store.js'
import { createService } from '../src/host/index.js'
import { registerTools } from '../src/host/tools.js'
import { createBoard } from '../src/core/model.js'
import { applyOps, OpError } from '../src/core/ops.js'

// ---- 构造最小的真实图片字节 ----
const crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return (buf) => { let c = 0xffffffff; for (const x of buf) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 } })()
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
const png = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.alloc(1 + w * 3); const raw = Buffer.concat(Array.from({ length: h }, () => row)); return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]) }
const gif = (w, h) => Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0])
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
const webpVP8X = (w, h) => { const b = Buffer.alloc(30); b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b }
const svg = (a) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${a}><rect/></svg>`)

test('imageDimensions: PNG / GIF / JPEG / WebP / SVG', () => {
  assert.deepEqual(imageDimensions(png(37, 21)), { w: 37, h: 21 })
  assert.deepEqual(imageDimensions(gif(300, 150)), { w: 300, h: 150 })
  assert.deepEqual(imageDimensions(jpeg(640, 480)), { w: 640, h: 480 })
  assert.deepEqual(imageDimensions(webpVP8X(800, 600)), { w: 800, h: 600 })
  assert.deepEqual(imageDimensions(svg('width="120" height="60"')), { w: 120, h: 60 })
  assert.deepEqual(imageDimensions(svg('viewBox="0 0 400 200"')), { w: 400, h: 200 })
})

test('imageDimensions: 垃圾/截断输入返回 null 而不是抛错', () => {
  for (const bad of [Buffer.alloc(0), Buffer.from('hello world'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8]), svg('foo="1"')]) assert.equal(imageDimensions(bad), null)
  assert.equal(imageDimensions(null), null)
})

// ---- 内核校验 ----
const mk = (...ops) => applyOps(createBoard({ id: 'b' }), ops).board
test('ops 校验: html 类型与大小', () => {
  assert.doesNotThrow(() => mk({ op: 'addNode', node: { id: 'h', type: 'html', x: 0, y: 0, html: '<p>x</p>' } }))
  assert.throws(() => mk({ op: 'addNode', node: { id: 'h', type: 'html', x: 0, y: 0, html: 123 } }), OpError)
  assert.throws(() => mk({ op: 'addNode', node: { id: 'h', type: 'html', x: 0, y: 0, html: 'a'.repeat(200 * 1024 + 1) } }), /exceeds/)
  const b = mk({ op: 'addNode', node: { id: 'h', type: 'html', x: 0, y: 0, html: 'ok' } })
  assert.throws(() => applyOps(b, [{ op: 'updateNode', id: 'h', patch: { html: 'a'.repeat(200 * 1024 + 1) } }]), /exceeds/)
})

test('ops 校验: 图片路径只能是 assets/ 下的简单文件名(防穿越)', () => {
  assert.doesNotThrow(() => mk({ op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, file: 'assets/0123abcd.png' } }))
  for (const bad of ['../board.json', '/etc/passwd', 'assets/../x.png', 'assets/a/b.png', 'x.png', 5]) {
    assert.throws(() => mk({ op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, file: bad } }), /image\.file/, String(bad))
  }
  const b = mk({ op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, file: 'assets/a.png' } })
  assert.throws(() => applyOps(b, [{ op: 'updateNode', id: 'i', patch: { file: '../../secret' } }]), /image\.file/)
})

test('ops 校验: 文本字段必须是字符串;natural 必须是正数宽高', () => {
  assert.throws(() => mk({ op: 'addNode', node: { id: 't', type: 'text', x: 0, y: 0, text: { a: 1 } } }), /text must be a string/)
  assert.throws(() => mk({ op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, natural: { w: 0, h: 5 } } }), /natural/)
  assert.doesNotThrow(() => mk({ op: 'addNode', node: { id: 'i', type: 'image', x: 0, y: 0, natural: { w: 10, h: 5 }, caption: '说明' } }))
})

test('ops 校验: 未知节点类型仍然原样接收(向前兼容)', () => {
  assert.doesNotThrow(() => mk({ op: 'addNode', node: { id: 'f', type: 'future-type', x: 0, y: 0, payload: { a: 1 } } }))
})

// ---- 导入链路 ----
async function env() {
  const dir = await mkdtemp(join(tmpdir(), 'wb-'))
  const store = new BoardStore(join(dir, 'lib'))
  const service = createService(store)
  const reg = new Map()
  registerTools({ effect: (fn) => fn(), tools: { register: (t) => reg.set(t.name, t) } }, service)
  const { board } = await service.create({ title: 't' })
  return { dir, store, service, reg, board: board.id }
}

test('addImage: 本机图片 → 白板资源 + 图片卡片,宽高比取自文件', async () => {
  const { dir, service, board, store } = await env()
  const p = join(dir, 'pic.png'); await writeFile(p, png(200, 100))
  const r = await service.addImage({ id: board, path: p, caption: '示意图', width: 300 })
  assert.equal(r.width, 300); assert.equal(r.height, 150)
  const { board: b } = await store.read(board)
  const n = b.nodes[0]
  assert.equal(n.type, 'image'); assert.match(n.file, /^assets\/[0-9a-f]{16}\.png$/); assert.equal(n.caption, '示意图'); assert.deepEqual(n.natural, { w: 200, h: 100 })
  assert.ok((await store.readAsset(board, n.file)).length > 0)
})

test('addImage: 同一张图加两次只存一份资源', async () => {
  const { dir, service, board, store } = await env()
  const p = join(dir, 'pic.png'); await writeFile(p, png(50, 50))
  const a = await service.addImage({ id: board, path: p }); const b = await service.addImage({ id: board, path: p })
  const nodes = (await store.read(board)).board.nodes
  assert.equal(nodes[0].file, nodes[1].file)
  assert.notEqual(a.id, b.id)
})

test('addImage: 错误输入给出明确原因,且不改动白板', async () => {
  const { dir, service, board, store } = await env()
  await assert.rejects(service.addImage({ id: board, path: join(dir, 'nope.png') }), /not found/)
  await writeFile(join(dir, 'a.txt'), 'x'); await assert.rejects(service.addImage({ id: board, path: join(dir, 'a.txt') }), /unsupported image type/)
  await assert.rejects(service.addImage({ id: board, path: dir }), /not a regular file/)
  assert.equal((await store.read(board)).board.nodes.length, 0)
})

test('agent 工具 add_image / html 卡片全流程', async () => {
  const { dir, reg, board } = await env()
  const edit = reg.get('thinkboard_edit'), read = reg.get('thinkboard_read')
  const p = join(dir, 'pic.png'); await writeFile(p, png(100, 100))
  const r = JSON.parse((await edit.execute({ action: 'add_image', board, path: p, caption: 'c', x: 10, y: 20 })).result)
  assert.equal(r.width, 100)
  await edit.execute({ board, ops: [{ op: 'addNode', node: { id: 'h', type: 'html', html: '<h3>报告</h3><script>alert(1)</script>', place: { rightOf: r.id } } }] })
  const g = JSON.parse((await read.execute({ board })).result)
  assert.deepEqual(g.nodes.map((n) => n.type), ['image', 'html'])
  assert.equal(g.nodes[0].x, 10)
  await assert.rejects(edit.execute({ action: 'add_image', board }), /path/)
  await assert.rejects(edit.execute({ action: 'add_image', board, path: '/definitely/not/here.png' }), /not found/)
})
