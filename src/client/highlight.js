// 行内高亮标记,语法同 Obsidian:==被高亮的文字==
//
// 与下划线标记同构(行内 tokenizer + 标记)。要点:
//   - 开头 "==" 之后不能是空白,结尾 "==" 之前不能是空白(避免把 a == b 当成高亮);
//   - 不跨段落;不吞代码段里的 "==";反斜杠转义 \== 不触发;
//   - 里面可以有粗体、斜体、链接等其它行内格式。

import { Mark, mergeAttributes, markInputRule, markPasteRule } from '@tiptap/core'
import { markLeadingMarkers, resolveSentinel } from '../core/mdescape.js'

const OPEN = /^==(?=[^\s=])/
// 找结束的 "==":前一个字符不是空白,且不是转义;跳过行内代码段
function findClose(src, from) {
  const delim = /\\[\s\S]|`+|==(?!=)/g
  delim.lastIndex = from
  let m
  while ((m = delim.exec(src))) {
    if (m[0].startsWith('`')) {
      const code = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(src.slice(m.index))
      if (code) delim.lastIndex = m.index + code[0].length
    } else if (m[0] === '==') {
      if (m.index > from && !/\s/.test(src[m.index - 1])) return m.index
    }
  }
  return -1
}

export const Highlight = Mark.create({
  name: 'highlight',
  addOptions() { return { HTMLAttributes: {} } },
  parseHTML() { return [{ tag: 'mark' }] },
  renderHTML({ HTMLAttributes }) { return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0] },

  parseMarkdown(token, helpers) { return helpers.applyMark(this.name, helpers.parseInline(token.tokens || [])) },
  renderMarkdown(node, helpers) { return `==${helpers.renderChildren(node)}==` },
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start(src) { return src.indexOf('==') },
    tokenize(src, _tokens, lexer) {
      if (!OPEN.test(src)) return
      const end = findClose(src, 2)
      if (end < 0) return
      const text = src.slice(2, end)
      if (!text || text.includes('\n\n')) return
      return { type: 'highlight', raw: src.slice(0, end + 2), text, tokens: lexer.inlineTokens(text) }
    },
  },

  addCommands() {
    return {
      setHighlight: () => ({ commands }) => commands.setMark(this.name),
      toggleHighlight: () => ({ commands }) => commands.toggleMark(this.name),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
  addKeyboardShortcuts() { return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight(), 'Mod-Shift-H': () => this.editor.commands.toggleHighlight() } },
  // 边输入边转换:输入 ==文字== 的最后一个 "=" 时变成高亮
  addInputRules() { return [markInputRule({ find: /(?:^|[^=\\])(==(?=[^\s=])([^=]+?(?<=[^\s=]))==)$/, type: this.type })] },
  addPasteRules() { return [markPasteRule({ find: /(?:^|[^=\\])(==(?=[^\s=])([^=]+?(?<=[^\s=]))==)/g, type: this.type })] },
})

/**
 * 让普通文字里的 "==" 在存盘时被转义。
 *
 * 为什么:Tiptap 默认只转义 \ ` * _ [ ] ~。引入高亮标记后,用户键入的字面量 "==x=="(没有高亮标记)
 * 如果原样存成 "==x==",下次读入就会变成高亮——文档内容被悄悄改了。所以文本里每一对相邻的 "=="
 * 都转义成 "\==",读入时 marked 把 "\=" 还原成 "=",结果仍是普通文字。
 *
 * 做法:覆盖 MarkdownManager 实例上的 escapeMarkdownSyntax(它是实例方法,不碰 Tiptap 源码)。
 * 只转义连续的 "=="(单个 "=" 到处都是,不转义);三个及以上的 "=" 也转义每一个,避免被拆成 "==" + "="。
 */
export function escapeLiteralHighlight(editor) {
  const mgr = editor?.markdown
  if (!mgr || mgr.__wbEscapePatched) return
  const base = mgr.escapeMarkdownSyntax.bind(mgr)
  // 先转义 "=="(上面的说明),再把行首哨兵换成反斜杠(行首的 # - 1. --- 等,见 core/mdescape.js)
  mgr.escapeMarkdownSyntax = (text) => resolveSentinel(base(text).replace(/={2,}/g, (run) => run.split('').map(() => '\\=').join('')))
  // 序列化入口:先给"行首像 Markdown 结构的普通段落"打哨兵
  const ser = mgr.serialize.bind(mgr)
  mgr.serialize = (doc) => ser(markLeadingMarkers(doc))
  mgr.__wbEscapePatched = true
}
