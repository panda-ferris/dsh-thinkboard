import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoardStore, StoreError } from '../src/host/store.js'

const tmp = async () => mkdtemp(join(tmpdir(), 'wb-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('store: 创建/列表/改名/复制/回收站', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board } = await s.create({ title: '第一张' })
  assert.deepEqual((await s.list()).map((b) => b.title), ['第一张'])
  await s.rename(board.id, '改名了')
  assert.equal((await s.read(board.id)).board.title, '改名了')
  const copy = await s.duplicate(board.id)
  assert.equal((await s.list()).length, 2)
  assert.notEqual(copy.board.id, board.id)
  await s.trash(board.id)
  assert.equal((await s.list()).length, 1)
  assert.ok((await readdir(join(dir, '.trash'))).length === 1)
  await rm(dir, { recursive: true })
})

test('store: apply 写盘、递增 rev、返回补全 id 后的 ops', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board, rev } = await s.create()
  const r = await s.apply(board.id, rev, [{ op: 'addNode', node: { type: 'text', x: 0, y: 0, text: 'hi' } }])
  assert.equal(r.rev, rev + 1)
  assert.ok(r.ops[0].node.id)
  const disk = JSON.parse(await readFile(join(dir, board.id, 'board.json'), 'utf8'))
  assert.equal(disk.nodes[0].text, 'hi')
})

test('store: baseRev 不符 → stale;非法 ops → 磁盘不变', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board, rev } = await s.create()
  await s.apply(board.id, rev, [{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } }])
  await assert.rejects(s.apply(board.id, rev, []), (e) => e instanceof StoreError && e.code === 'stale')
  const before = await readFile(join(dir, board.id, 'board.json'), 'utf8')
  await assert.rejects(s.apply(board.id, undefined, [{ op: 'removeNodes', ids: ['nope'] }]))
  assert.equal(await readFile(join(dir, board.id, 'board.json'), 'utf8'), before)
})

test('store: 并发 apply 被串行化,全部落盘', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board } = await s.create()
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    s.apply(board.id, undefined, [{ op: 'addNode', node: { id: `n${i}`, type: 'text', x: i, y: 0 } }])))
  assert.equal((await s.read(board.id)).board.nodes.length, 20)
})

test('store: id 与资源路径防穿越', async () => {
  const s = new BoardStore(await tmp())
  assert.throws(() => s.dir('../etc'), /invalid board id/)
  const { board } = await s.create()
  await assert.rejects(s.readAsset(board.id, '../board.json'), (e) => e.code === 'forbidden')
})

test('store: 图片按内容哈希去重,限制类型', async () => {
  const s = new BoardStore(await tmp())
  const { board } = await s.create()
  const a = await s.saveImage(board.id, new Uint8Array([1, 2, 3]), 'a.png')
  const b = await s.saveImage(board.id, new Uint8Array([1, 2, 3]), 'other-name.png')
  assert.equal(a.file, b.file)
  assert.deepEqual([...(await s.readAsset(board.id, a.file))], [1, 2, 3])
  await assert.rejects(s.saveImage(board.id, new Uint8Array([1]), 'x.exe'), (e) => e.code === 'bad-type')
})

test('store: 损坏文件报 corrupt,且 list 不崩溃', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board } = await s.create()
  await writeFile(join(dir, board.id, 'board.json'), '{not json')
  await assert.rejects(s.read(board.id), (e) => e.code === 'corrupt')
  assert.equal((await s.list())[0].broken, true)
})

test('store.watch: 外部改动通知一次;自己写入不通知', async () => {
  const dir = await tmp()
  const s = new BoardStore(dir)
  const { board, rev } = await s.create()
  const seen = []
  const stop = s.watch((id) => seen.push(id))
  try {
    await sleep(100)
    await s.apply(board.id, rev, [{ op: 'addNode', node: { id: 'a', type: 'text', x: 0, y: 0 } }])
    await sleep(500)
    assert.deepEqual(seen, [], '自己的写入不应触发')
    const text = (await readFile(join(dir, board.id, 'board.json'), 'utf8')).replace('"x":0', '"x":99')
    await writeFile(join(dir, board.id, 'board.json'), text)
    await sleep(500)
    assert.deepEqual(seen, [board.id])
  } finally {
    stop()
  }
})
