import test from 'node:test'
import assert from 'node:assert/strict'
import { styleForDepth, toAlpha, toRoman, marker, numberTree, sinkItem, liftItem, dumpTree } from '../src/core/lists.js'

test('层级样式:一级数字、二级字母、三级罗马,第四级循环回数字', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(styleForDepth), ['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha', 'lower-roman', 'decimal'])
})

test('字母编号:a..z 之后接 aa, ab …(26 进制,无零)', () => {
  assert.deepEqual([1, 2, 26, 27, 28, 52, 53, 702, 703].map(toAlpha), ['a', 'b', 'z', 'aa', 'ab', 'az', 'ba', 'zz', 'aaa'])
  assert.equal(toAlpha(0), '0'); assert.equal(toAlpha(-1), '-1'); assert.equal(toAlpha(1.5), '1.5')
})

test('罗马数字:常见值、减法规则、边界', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 10, 14, 19, 40, 49, 90, 400, 1994, 3999].map(toRoman),
    ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'ix', 'x', 'xiv', 'xix', 'xl', 'xlix', 'xc', 'cd', 'mcmxciv', 'mmmcmxcix'])
  assert.equal(toRoman(0), '0'); assert.equal(toRoman(4000), '4000')
})

test('marker 带点号', () => {
  assert.equal(marker(3, 'decimal'), '3.'); assert.equal(marker(3, 'lower-alpha'), 'c.'); assert.equal(marker(4, 'lower-roman'), 'iv.')
})

const T = (text, children) => ({ text, ...(children ? { children } : {}) })

test('numberTree:同层并列连续;进入子层从 1 重新开始;样式随深度', () => {
  const tree = [T('甲'), T('乙', [T('乙1', [T('乙1a'), T('乙1b')]), T('乙2')]), T('丙')]
  const r = numberTree(tree).map((x) => `${x.item.text}=${x.marker}`)
  assert.deepEqual(r, ['甲=1.', '乙=2.', '乙1=a.', '乙1a=i.', '乙1b=ii.', '乙2=b.', '丙=3.'])
})

test('numberTree:子层并列项编号连续到很大也不出错', () => {
  const kids = Array.from({ length: 30 }, (_, i) => T('k' + i))
  const r = numberTree([T('p', kids)])
  assert.equal(r[1].marker, 'a.'); assert.equal(r[26].marker, 'z.'); assert.equal(r[27].marker, 'aa.'); assert.equal(r[30].marker, 'ad.')
})

test('numberTree:尊重列表的起始序号', () => {
  assert.deepEqual(numberTree([T('x'), T('y')], { start: 5 }).map((x) => x.marker), ['5.', '6.'])
  assert.deepEqual(numberTree([T('p', [T('c')])]).map((x) => x.marker), ['1.', 'a.'])
})

// ---------- 缩进语义:子层相对层级不变 ----------
const BASE = () => [T('甲'), T('乙', [T('乙一', [T('乙一甲')]), T('乙二')]), T('丙')]

test('缩进(sink):目标连同整棵子树成为前一兄弟的子项,子树内部相对层级不变', () => {
  const r = sinkItem(BASE(), [1])
  assert.deepEqual(dumpTree(r), ['甲', '  乙', '    乙一', '      乙一甲', '    乙二', '丙'])
})

test('缩进后相对层级:乙一 仍是 乙 的直接子项,乙一甲 仍是 乙一 的子项', () => {
  const r = sinkItem(BASE(), [1])
  const yi = r[0].children[0]
  assert.equal(yi.text, '乙'); assert.equal(yi.children[0].text, '乙一'); assert.equal(yi.children[0].children[0].text, '乙一甲')
})

test('缩进:第一个同级项不能缩进;不修改原树', () => {
  const t = BASE()
  assert.equal(sinkItem(t, [0]), null)
  assert.equal(sinkItem(t, [1, 0]), null)
  sinkItem(t, [1])
  assert.deepEqual(dumpTree(t), ['甲', '乙', '  乙一', '    乙一甲', '  乙二', '丙'])
})

test('提升(lift):目标连同子树成为父项的下一个兄弟;后面的兄弟留在原父项下', () => {
  const r = liftItem(BASE(), [1, 0])
  assert.deepEqual(dumpTree(r), ['甲', '乙', '  乙二', '乙一', '  乙一甲', '丙'])
})

test('提升:顶层项不能再提升(返回 null,不会把列表拆散)', () => {
  assert.equal(liftItem(BASE(), [1]), null)
  assert.equal(liftItem(BASE(), [0]), null)
})

test('提升后父项没有子项了就不留空的 children', () => {
  const t = [T('a', [T('b')])]
  const r = liftItem(t, [0, 0])
  assert.deepEqual(dumpTree(r), ['a', 'b'])
  assert.ok(!('children' in r[0]))
})

test('缩进再提升可还原', () => {
  const t = BASE()
  const there = sinkItem(t, [2])            // 丙 缩进到 乙 下
  const back = liftItem(there, [1, 2])      // 再提升
  assert.deepEqual(dumpTree(back), dumpTree(t))
})
