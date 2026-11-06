import test from 'node:test'
import assert from 'node:assert/strict'
import { TABLE_ACTIONS, actionStates, toolbarPosition, tableVisible, headerState, tableDims } from '../src/core/tabletools.js'

const all = () => true
const none = () => false

test('9 个操作,id 与命令名各自唯一,分组齐全', () => {
  assert.equal(TABLE_ACTIONS.length, 9)
  assert.equal(new Set(TABLE_ACTIONS.map((a) => a.id)).size, 9); assert.equal(new Set(TABLE_ACTIONS.map((a) => a.cmd)).size, 9)
  assert.deepEqual([...new Set(TABLE_ACTIONS.map((a) => a.group))], ['row', 'col', 'head', 'table'])
})

test('删除类操作标记为 danger(用于样式与二次确认的判断)', () => {
  assert.deepEqual(TABLE_ACTIONS.filter((a) => a.danger).map((a) => a.id), ['rowDelete', 'colDelete', 'tableDelete'])
})

test('在表格里且库允许:全部可用(表头行除外)', () => {
  const s = actionStates(all, { inHeader: false })
  assert.ok(Object.values(s).every(Boolean))
})

test('在表头行上:"向上加行"被禁用(否则新行会插到表头之前),其它照常', () => {
  const s = actionStates(all, { inHeader: true })
  assert.equal(s.rowBefore, false)
  for (const id of ['rowAfter', 'rowDelete', 'colBefore', 'colAfter', 'colDelete', 'headerRow', 'headerCol', 'tableDelete']) assert.equal(s[id], true, id)
})

test('库说不能做的,工具条也不可用(例如只剩一行/一列时不能删)', () => {
  const s = actionStates((cmd) => cmd !== 'deleteRow' && cmd !== 'deleteColumn', { inHeader: false })
  assert.equal(s.rowDelete, false); assert.equal(s.colDelete, false); assert.equal(s.rowAfter, true)
})

test('光标在表格外:全部不可用,即使 can() 误报可用', () => {
  assert.ok(Object.values(actionStates(none, { inTable: false })).every((v) => v === false))
  assert.ok(Object.values(actionStates(all, { inTable: false })).every((v) => v === false))
})

test('can 返回非布尔值(undefined/null)按不可用处理', () => {
  assert.ok(Object.values(actionStates(() => undefined)).every((v) => v === false))
  assert.ok(Object.values(actionStates(() => null)).every((v) => v === false))
})

const VP = { w: 1200, h: 800 }
const size = { w: 300, h: 36 }

test('toolbarPosition: 默认在表格上方居中', () => {
  const p = toolbarPosition({ left: 400, top: 300, width: 400, height: 200, bottom: 500, right: 800 }, size, VP)
  assert.deepEqual(p, { left: 450, top: 256, side: 'above' })
})

test('toolbarPosition: 上方放不下 → 放到表格下方', () => {
  const p = toolbarPosition({ left: 400, top: 20, width: 400, height: 200, bottom: 220, right: 800 }, size, VP)
  assert.equal(p.side, 'below'); assert.equal(p.top, 228)
})

test('toolbarPosition: 上下都放不下(表格占满视口)→ 贴在表格内侧顶部,仍在视口内', () => {
  const p = toolbarPosition({ left: 0, top: 0, width: 1200, height: 800, bottom: 800, right: 1200 }, size, VP)
  assert.equal(p.side, 'inside'); assert.ok(p.top >= 0 && p.top + size.h <= VP.h)
})

test('toolbarPosition: 横向夹在视口内(表格靠左/靠右)', () => {
  const left = toolbarPosition({ left: -200, top: 300, width: 300, height: 100, bottom: 400, right: 100 }, size, VP)
  assert.ok(left.left >= 8)
  const right = toolbarPosition({ left: 1000, top: 300, width: 400, height: 100, bottom: 400, right: 1400 }, size, VP)
  assert.ok(right.left + size.w <= VP.w - 8)
})

test('tableVisible: 与视口相交才显示', () => {
  assert.ok(tableVisible({ left: 100, top: 100, right: 300, bottom: 300 }, VP))
  assert.ok(tableVisible({ left: 100, top: -50, right: 300, bottom: 20 }, VP))               // 部分可见
  assert.ok(!tableVisible({ left: 100, top: -300, right: 300, bottom: -10 }, VP))            // 完全在上方
  assert.ok(!tableVisible({ left: 100, top: 900, right: 300, bottom: 1100 }, VP))            // 完全在下方
  assert.ok(!tableVisible({ left: -400, top: 100, right: -10, bottom: 300 }, VP))            // 完全在左侧
  assert.ok(!tableVisible({ left: 1300, top: 100, right: 1500, bottom: 300 }, VP))           // 完全在右侧
})

const H = 'tableHeader', D = 'tableCell'
test('headerState: 标准表格(首行表头)→ 有表头行、无表头列', () => { assert.deepEqual(headerState([[H, H], [D, D], [D, D]]), { row: true, col: false }) })
test('headerState: 首列表头(正文每行第一格是表头)→ 有表头列', () => { assert.deepEqual(headerState([[D, D], [H, D], [H, D]]), { row: false, col: true }) })
test('headerState: 同时有表头行与表头列(左上角也是表头)', () => { assert.deepEqual(headerState([[H, H], [H, D], [H, D]]), { row: true, col: true }) })
test('headerState: 都没有', () => { assert.deepEqual(headerState([[D, D], [D, D]]), { row: false, col: false }) })
test('headerState: 只有一行或空输入不抛错', () => {
  assert.deepEqual(headerState([[H, H]]), { row: true, col: false }); assert.deepEqual(headerState([[D]]), { row: false, col: false })
  for (const bad of [null, undefined, [], [[]], 'x']) assert.deepEqual(headerState(bad), { row: false, col: false })
})
test('headerState: 只有左上角是表头不算表头行也不算表头列', () => { assert.deepEqual(headerState([[H, D], [D, D]]), { row: false, col: false }) })

test('只剩 1 列:"删除列"不可用(库的 can() 对最后一列误报可用);只剩 1 行同理', () => {
  const s1 = actionStates(all, { cols: 1, rows: 3 }); assert.equal(s1.colDelete, false); assert.equal(s1.rowDelete, true)
  const s2 = actionStates(all, { cols: 3, rows: 1 }); assert.equal(s2.rowDelete, false); assert.equal(s2.colDelete, true)
  const s3 = actionStates(all, { cols: 2, rows: 2 }); assert.equal(s3.colDelete, true); assert.equal(s3.rowDelete, true)
})

test('只剩 1 列时"删除表格"仍可用(整个删掉的出口)', () => { assert.equal(actionStates(all, { cols: 1, rows: 1 }).tableDelete, true) })

test('tableDims: 行数、最大列数;空/非法输入为 0', () => {
  assert.deepEqual(tableDims([['a', 'b'], ['c']]), { rows: 2, cols: 2 }); assert.deepEqual(tableDims([['a']]), { rows: 1, cols: 1 })
  for (const bad of [null, undefined, [], 'x']) assert.deepEqual(tableDims(bad), { rows: 0, cols: 0 })
})
