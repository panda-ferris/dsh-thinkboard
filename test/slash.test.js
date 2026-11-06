import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMANDS, detectSlash, filterCommands, moveIndex, clampTableSize, parseTableSize, TABLE_MAX_ROWS, TABLE_MAX_COLS, isImageFile, isAssetPath, mapAssetUrls } from '../src/core/slash.js'

test('detectSlash: 行首、空白之后的 / 触发;携带查询', () => {
  assert.deepEqual(detectSlash('/'), { from: 0, query: '' })
  assert.deepEqual(detectSlash('/tab'), { from: 0, query: 'tab' })
  assert.deepEqual(detectSlash('文字 /图'), { from: 3, query: '图' })
  assert.deepEqual(detectSlash('a\n/h2'), { from: 2, query: 'h2' })
})

test('detectSlash: 单词中间的 /、网址、路径不触发', () => {
  for (const s of ['a/b', 'http://x.com', 'https://x.com/p', '1/2', 'and/or', '路径/文件']) assert.equal(detectSlash(s), null, s)
})

test('detectSlash: 查询里出现空白(已在写正常文字)、查询过长,不触发', () => {
  assert.equal(detectSlash('/table 然后'), null)
  assert.equal(detectSlash('/' + 'x'.repeat(21)), null)
  assert.deepEqual(detectSlash('/' + 'x'.repeat(20)), { from: 0, query: 'x'.repeat(20) })
})

test('detectSlash: 取光标前最后一个 /', () => {
  assert.deepEqual(detectSlash('/a /b'), { from: 3, query: 'b' })
  assert.equal(detectSlash('/a b/c'), null)
})

test('filterCommands: 空查询列出全部,表格与图片排最前', () => {
  const all = filterCommands('')
  assert.equal(all.length, COMMANDS.length); assert.deepEqual(all.slice(0, 2).map((c) => c.id), ['table', 'image'])
})

test('filterCommands: 中文关键词与英文关键词都能命中', () => {
  assert.deepEqual(filterCommands('表格').map((c) => c.id), ['table'])
  assert.deepEqual(filterCommands('table').map((c) => c.id), ['table'])
  assert.deepEqual(filterCommands('图片').map((c) => c.id), ['image'])
  assert.ok(filterCommands('列表').map((c) => c.id).includes('bullet'))
  assert.ok(filterCommands('列表').map((c) => c.id).includes('ordered'))
})

test('filterCommands: 前缀匹配排在包含匹配之前;大小写与空白不敏感', () => {
  const ids = filterCommands('H').map((c) => c.id)
  assert.deepEqual(ids.slice(0, 3), ['h1', 'h2', 'h3'])
  assert.deepEqual(filterCommands(' TABLE ').map((c) => c.id), ['table'])
})

test('filterCommands: 用界面语言的显示名也能匹配', () => {
  const label = (id) => ({ table: 'Table', image: 'Picture' }[id] ?? id)
  assert.deepEqual(filterCommands('pic', label).map((c) => c.id), ['image'])
})

test('filterCommands: 单个字符不做"包含匹配"——"表"只命中表格,不命中"无序列表"', () => {
  assert.deepEqual(filterCommands('表').map((c) => c.id), ['table'])
  assert.deepEqual(filterCommands('图').map((c) => c.id), ['image'])
})

test('filterCommands: 较长的查询仍支持包含匹配(显示名里的片段)', () => {
  const label = (id) => ({ ordered: '有序列表' }[id] ?? id)
  assert.ok(filterCommands('序列表', label).map((c) => c.id).includes('ordered'))
  assert.ok(filterCommands('blockq').map((c) => c.id).includes('quote'))
})

test('filterCommands: 没有匹配 → 空', () => { assert.deepEqual(filterCommands('zzzz没有'), []) })

test('moveIndex: 循环移动,空列表安全', () => {
  assert.equal(moveIndex(0, -1, 5), 4); assert.equal(moveIndex(4, 1, 5), 0); assert.equal(moveIndex(2, 1, 5), 3); assert.equal(moveIndex(0, 1, 0), 0)
})

test('表格尺寸:夹到范围内;非数字回到默认', () => {
  assert.deepEqual(clampTableSize(1, 0), { rows: 2, cols: 1 })
  assert.deepEqual(clampTableSize(99, 99), { rows: TABLE_MAX_ROWS, cols: TABLE_MAX_COLS })
  assert.deepEqual(clampTableSize('x', undefined), { rows: 3, cols: 3 })
  assert.deepEqual(clampTableSize(4.6, 2.2), { rows: 5, cols: 2 })
})

test('表格尺寸文字:4x3 / 4×3 / 4 3 / 4,3 / 4，3 都能解析,行在前列在后', () => {
  for (const s of ['4x3', '4X3', '4×3', '4 3', '4,3', '4，3', ' 4 x 3 ', '4*3']) assert.deepEqual(parseTableSize(s), { rows: 4, cols: 3 }, s)
  assert.deepEqual(parseTableSize('30x30'), { rows: TABLE_MAX_ROWS, cols: TABLE_MAX_COLS })
  for (const bad of ['', 'abc', '4', '4x', 'x3', '4x3x2', '-1x2']) assert.equal(parseTableSize(bad), null, bad)
})

test('isImageFile: 只认常见图片类型', () => {
  assert.ok(isImageFile({ type: 'image/png' }) && isImageFile({ type: 'image/webp' }))
  assert.ok(!isImageFile({ type: 'application/pdf' }) && !isImageFile({ type: '' }) && !isImageFile(null))
})

test('isAssetPath: 与内核同一规则', () => {
  assert.ok(isAssetPath('assets/abc123.png') && isAssetPath('assets/a-b_c.d.webp'))
  for (const bad of ['assets/../x.png', '../assets/x.png', 'assets/', 'assets/a/b.png', 'http://x/a.png', 'data:image/png;base64,AAA', '/assets/x.png', 'assets/a b.png', 5, null]) assert.ok(!isAssetPath(bad), String(bad))
})

test('mapAssetUrls: 只替换合法的 assets/ 路径,其它原样', () => {
  const url = (f) => `/api/x?file=${encodeURIComponent(f)}`
  const html = '<p><img src="assets/a.png" alt="x"><img src="https://e.com/p.png"><img src="data:image/png;base64,AA"><img src="assets/../etc/passwd"><img alt="y" src=\'assets/b.jpg\'></p>'
  const out = mapAssetUrls(html, url)
  assert.ok(out.includes('src="/api/x?file=assets%2Fa.png"'))
  assert.ok(out.includes("src='/api/x?file=assets%2Fb.jpg'"))
  assert.ok(out.includes('src="https://e.com/p.png"') && out.includes('src="data:image/png;base64,AA"') && out.includes('src="assets/../etc/passwd"'))
})

test('mapAssetUrls: 没有图片、空输入不出错', () => { assert.equal(mapAssetUrls('<p>x</p>', () => 'u'), '<p>x</p>'); assert.equal(mapAssetUrls('', () => 'u'), '') })
