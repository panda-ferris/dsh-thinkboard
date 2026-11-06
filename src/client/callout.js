// 高亮块(callout):blockquote 的变体。
//
// 为什么是变体而不是新节点:
//   - 内容模型(block+)、嵌套、回车/退格行为、粘贴、"> " 输入规则 全部沿用 blockquote;
//   - 普通引用就是 callout 属性为空的 blockquote,二者可以互相转换而不丢内容;
//   - Markdown 里 callout 本来就是 "> [!type] 标题" 开头的 blockquote。
//
// 存储:  > [!type]± 标题
//        > 正文……
// 属性:  calloutType(原写法,保留大小写)、calloutFold(null|'open'|'closed')、calloutTitle(字符串)
//
// 标题是"属性"而不是第一个子块:这样正文的内容模型不变,标题在节点头部单独编辑(NodeView)。

import Blockquote from '@tiptap/extension-blockquote'
import { mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { parseCalloutHead, formatCalloutHead, splitFirstLine, canonicalType, defaultTitle, isValidType } from '../core/callout.js'

// 注意:属性级 parseHTML 在返回非 null 时会覆盖解析规则里 getAttrs 算出的同名属性。
// 所以元素上没有对应 data- 属性时必须返回 null(而不是默认值),让规则里的 getAttrs 决定;缺省值由 default 负责。
const attr = (name, def) => ({
  default: def,
  parseHTML: (el) => el.getAttribute('data-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())),
  renderHTML: (a) => (a[name] == null || a[name] === '' ? {} : { ['data-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]: a[name] }),
})

export const Callout = Blockquote.extend({
  name: 'blockquote',   // 沿用 blockquote 的名字:普通引用和 callout 是同一个节点类型

  // 间隙光标说明见下方 addProseMirrorPlugins:不依赖 createGapCursor(它会让高亮块"内部"的边界也变成合法的
  // 间隙位置,光标会掉进高亮块里一个看不见的槽位),而是由我们自己把间隙光标放到高亮块的"外侧"。

  addAttributes() {
    return {
      ...this.parent?.(),
      calloutType: attr('calloutType', null),
      calloutFold: attr('calloutFold', null),
      calloutTitle: attr('calloutTitle', ''),
    }
  },

  // ---------- 节点 → HTML(渲染态与复制用) ----------
  // callout:<div class="wb-callout" data-callout="类型" data-fold="…"><div class="wb-callout-title">…</div><div class="wb-callout-body">…</div></div>
  // 普通引用:<blockquote>
  // 内容洞(0)必须在 body 里;标题栏不是内容,只是属性的展示。
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs
    if (!isValidType(a.calloutType)) return ['blockquote', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
    const canon = canonicalType(a.calloutType)
    const title = (a.calloutTitle || '').trim() || defaultTitle(a.calloutType)
    return ['div', {
      class: 'wb-callout', 'data-callout': a.calloutType, 'data-callout-kind': canon.id, 'data-callout-color': canon.color,
      ...(a.calloutFold ? { 'data-fold': a.calloutFold } : {}),
    },
    ['div', { class: 'wb-callout-title', contenteditable: 'false' },
      ['span', { class: 'wb-callout-icon', 'data-icon': canon.icon, 'aria-hidden': 'true' }],
      ['span', { class: 'wb-callout-title-text' }, title],
      ...(a.calloutFold ? [['span', { class: 'wb-callout-chevron', 'aria-hidden': 'true' }]] : [])],
    ['div', { class: 'wb-callout-body' }, 0]]
  },

  // 从 HTML 读回(粘贴、setContent):识别我们自己输出的结构,以及 Obsidian/GitHub 风格的 [!type] 引用
  parseHTML() {
    return [
      {
        tag: 'div.wb-callout',
        contentElement: '.wb-callout-body',
        getAttrs: (el) => ({
          calloutType: el.getAttribute('data-callout') || 'note',
          calloutFold: el.getAttribute('data-fold') || null,
          calloutTitle: el.querySelector('.wb-callout-title-text')?.textContent?.trim() === defaultTitle(el.getAttribute('data-callout') || 'note') ? '' : (el.querySelector('.wb-callout-title-text')?.textContent?.trim() || ''),
        }),
      },
      // Obsidian 阅读模式(及 Obsidian Publish)复制出来的 callout:
      //   <div class="callout" data-callout="warning"><div class="callout-title"><div class="callout-title-inner">标题</div></div><div class="callout-content">…</div></div>
      {
        tag: 'div.callout[data-callout]',
        contentElement: '.callout-content',
        getAttrs: (el) => {
          const type = (el.getAttribute('data-callout') || 'note').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'note'
          const fold = el.getAttribute('data-callout-fold')
          const title = el.querySelector('.callout-title-inner')?.textContent?.trim() || ''
          return { calloutType: type, calloutFold: fold === '-' ? 'closed' : fold === '+' ? 'open' : null, calloutTitle: title.toLowerCase() === type.toLowerCase() ? '' : title }
        },
      },
      // 本应用复制出去、又粘回来的高亮块(复制时降级成了带内联样式的引用块,带 data-wb-callout 标记)
      {
        tag: 'blockquote[data-wb-callout]',
        getAttrs: (el) => {
          const type = (el.getAttribute('data-wb-callout') || 'note').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'note'
          const titleEl = el.querySelector(':scope > [data-wb-callout-title]')
          const title = titleEl?.textContent?.trim() || ''
          titleEl?.remove()          // 标题是属性,不能再作为正文里的一段出现(解析发生在剪贴板内容的副本上,不影响页面)
          const fold = el.getAttribute('data-wb-callout-fold')
          return { calloutType: type, calloutFold: fold === 'closed' || fold === 'open' ? fold : null, calloutTitle: title }
        },
      },
      { tag: 'blockquote' },
    ]
  },

  // ---------- 编辑态:标题栏可编辑,折叠可点击 ----------
  // 标题是节点属性(不是内容),所以用 NodeView:标题栏是一个独立的 <input>,正文是 contentDOM。
  // 普通引用(没有 calloutType)沿用默认的 <blockquote> 渲染,不走 NodeView。
  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const plain = !isValidType(node.attrs.calloutType)
      if (plain) {
        const dom = document.createElement('blockquote')
        return { dom, contentDOM: dom }
      }
      const dom = document.createElement('div')
      dom.className = 'wb-callout'
      const head = document.createElement('div')
      head.className = 'wb-callout-title'
      head.contentEditable = 'false'
      const icon = document.createElement('span'); icon.className = 'wb-callout-icon'; icon.setAttribute('aria-hidden', 'true')
      const input = document.createElement('input')
      input.className = 'wb-callout-title-input'; input.type = 'text'; input.spellcheck = false
      const chevron = document.createElement('span'); chevron.className = 'wb-callout-chevron'; chevron.setAttribute('aria-hidden', 'true')
      head.append(icon, input, chevron)
      const body = document.createElement('div'); body.className = 'wb-callout-body'
      dom.append(head, body)

      const setAttrs = (patch) => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }))
      }
      const paint = () => {
        const a = node.attrs, canon = canonicalType(a.calloutType)
        dom.setAttribute('data-callout', a.calloutType); dom.setAttribute('data-callout-kind', canon.id); dom.setAttribute('data-callout-color', canon.color)
        if (a.calloutFold) dom.setAttribute('data-fold', a.calloutFold); else dom.removeAttribute('data-fold')
        icon.setAttribute('data-icon', canon.icon)
        input.placeholder = defaultTitle(a.calloutType)
        if (document.activeElement !== input) input.value = a.calloutTitle || ''
        chevron.style.display = a.calloutFold ? '' : 'none'
        head.title = a.calloutFold ? (a.calloutFold === 'closed' ? '展开' : '折叠') : ''
      }
      paint()

      // 标题输入:每次输入即写回属性(撤销栈里合并为一步由编辑器的历史合并处理)
      input.addEventListener('input', () => setAttrs({ calloutTitle: input.value }))
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.isComposing) return
        // 回车 / ↓ / Tab:进入正文;Esc 也回到正文(不提交整张卡片,那是正文编辑器的职责)
        if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Tab' || e.key === 'Escape') {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + 2).run()
        }
      })
      // 折叠:点标题栏(但不是点输入框)切换;只有设了折叠标记的才可点
      head.addEventListener('mousedown', (e) => {
        if (e.target === input) return
        e.preventDefault()
        const a = node.attrs
        if (a.calloutFold) setAttrs({ calloutFold: a.calloutFold === 'closed' ? 'open' : 'closed' })
        else input.focus()
      })

      return {
        dom, contentDOM: body,
        update(next) {
          if (next.type !== node.type) return false
          // 普通引用 ↔ callout 的切换要重建视图
          if (isValidType(next.attrs.calloutType) !== isValidType(node.attrs.calloutType)) return false
          node = next; paint(); return true
        },
        // 标题输入框里的事件由我们自己处理,不要交给 ProseMirror
        stopEvent: (e) => head.contains(e.target),
        ignoreMutation: (m) => head.contains(m.target),
      }
    }
  },


  // ---------- Markdown → 节点 ----------
  // blockquote 的第一个子块是段落,且它的第一行形如 "[!type]± 标题" → callout。
  // 该段落首行之后的文字仍属于正文(同一段落的后续行),要保留下来。
  //
  // 空行(space token)不解析成空段落:块与块之间本来就靠空行分隔,把它们变成"空段落"节点,
  // 输出时又各占一行 ">",每存一次就多出一批空行(原生 Tiptap 的引用有同样的问题)。
  parseMarkdown(token, helpers) {
    const parseChildren = helpers.parseChildren
    const tokens = (token.tokens || []).filter((t) => t.type !== 'space')
    const first = tokens[0]
    if (first && first.type === 'paragraph') {
      const { first: line, rest } = splitFirstLine(first.text ?? first.raw ?? '')
      const head = parseCalloutHead(line)
      if (head) {
        const body = []
        if (rest.trim()) {
          const inline = helpers.tokenizeInline ? helpers.tokenizeInline(rest) : [{ type: 'text', raw: rest, text: rest }]
          body.push({ type: 'paragraph', content: helpers.parseInline(inline) })
        }
        body.push(...parseChildren(tokens.slice(1)))
        return helpers.createNode('blockquote', { calloutType: head.type, calloutFold: head.fold, calloutTitle: head.title }, body.length ? body : [{ type: 'paragraph' }])
      }
    }
    return helpers.createNode('blockquote', undefined, parseChildren(tokens))
  },

  // ---------- 节点 → Markdown ----------
  renderMarkdown(node, h) {
    const a = node.attrs ?? {}
    const prefix = '>'
    const isEmptyPara = (n) => n.type === 'paragraph' && !n.content?.length
    // 子块的 Markdown 去掉首尾空行(表格等块自带前后换行),再逐行加前缀
    const quote = (text) => text.replace(/^\n+|\n+$/g, '').split('\n').map((l) => (l.trim() === '' ? prefix : `${prefix} ${l}`)).join('\n')
    const blocks = (node.content ?? []).filter((n) => !isEmptyPara(n))   // 块之间的空行由分隔符 ">" 表达,空段落不输出
    const isCallout = isValidType(a.calloutType)
    const body = blocks.map((child) => quote(h.renderChild?.(child, (node.content ?? []).indexOf(child)) ?? h.renderChildren([child])))
    if (!isCallout) return body.join(`\n${prefix}\n`)
    const head = `${prefix} ${formatCalloutHead({ type: a.calloutType, fold: a.calloutFold, title: (a.calloutTitle || '').replace(/\s+/g, ' ').trim() })}`
    if (!body.length) return head   // 没有实质内容 = title-only callout
    // 首行与第一个块之间:第一块是段落时紧挨着写(Obsidian 的惯例,段落的后续行就是正文);
    // 第一块是表格/列表/代码块等时空一行,否则别的 Markdown 解析器会把它们并进标题那一行,表格就不渲染了
    const firstIsPara = blocks[0].type === 'paragraph'
    return `${head}${firstIsPara ? '\n' : `\n${prefix}\n`}${body.join(`\n${prefix}\n`)}`
  },

  // ---------- 外侧间隙光标 ----------
  // 问题:createGapCursor 让高亮块能出现间隙光标,但 ProseMirror 会把它放进高亮块"内部"的第一个/最后一个位置
  // (高亮块内含文字块,内部边界同样满足"闭合"),结果按 ↑ 只是进入高亮块里一个看不见的槽位,
  // 输入的字也落进高亮块的正文开头,根本没有离开高亮块。
  // 做法:拦截 ↑ ← ↓ →,当光标在高亮块第一个/最后一个文字块的边缘时,直接把间隙光标放到高亮块的"外侧"
  // (文档里高亮块前一个位置 / 后一个位置),并且只在那里确实没有可放光标的普通文字块时才这么做。
  addProseMirrorPlugins() {
    // 返回应放置间隙光标的文档位置;不该拦截时返回 null
    const outside = (state, dir) => {
      const { selection } = state
      if (!selection.empty) return null
      const { $from } = selection
      // 最外层的高亮块祖先
      let cd = -1
      for (let d = 1; d < $from.depth; d++) {
        const n = $from.node(d)
        if (n.type.name === 'blockquote' && isValidType(n.attrs.calloutType)) { cd = d; break }
      }
      if (cd < 0) return null
      const callout = $from.node(cd)
      const parent = $from.node(cd - 1)
      const idx = $from.index(cd - 1)
      // 光标必须在高亮块"直接子文字块"里(更深的列表/嵌套结构不拦截),并且是它的第一个/最后一个子块的边缘
      if ($from.depth !== cd + 1) return null
      if (dir < 0) {
        if ($from.parentOffset !== 0 || $from.index(cd) !== 0) return null
        const before = idx > 0 ? parent.child(idx - 1) : null
        if (before && before.isTextblock) return null                      // 前面有普通文字块:默认移动即可
        if (before && before.type.name === 'blockquote' && !isValidType(before.attrs.calloutType)) return null
        return $from.before(cd)
      }
      if ($from.parentOffset !== $from.parent.content.size || $from.index(cd) !== callout.childCount - 1) return null
      const after = idx < parent.childCount - 1 ? parent.child(idx + 1) : null
      if (!after || after.isTextblock) return null                          // 后面是普通文字块或文档末尾:默认移动即可
      if (after.type.name === 'blockquote' && !isValidType(after.attrs.calloutType)) return null
      return $from.after(cd)
    }
    const move = (dir) => (view) => {
      const pos = outside(view.state, dir)
      if (pos == null) return false
      const $pos = view.state.doc.resolve(pos)
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)).scrollIntoView())
      return true
    }
    const up = move(-1), down = move(+1)
    return [new Plugin({
      key: new PluginKey('wbCalloutOutside'),
      props: {
        handleKeyDown(view, e) {
          if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { if (!view.endOfTextblock(e.key === 'ArrowUp' ? 'up' : 'left')) return false; return up(view) }
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { if (!view.endOfTextblock(e.key === 'ArrowDown' ? 'down' : 'right')) return false; return down(view) }
          return false
        },
      },
    })]
  },

  // ---------- 键盘 ----------
  // 退格(只改高亮块,普通引用沿用 Tiptap 默认行为):
  //   - 光标在高亮块"非首块"的行首:默认行为是把这一块整个提出引用块(光标跳到块外),
  //     对"最后一行删到行首"来说太突然。改为交给编辑器默认的"和前一块合并"。
  //   - 光标在"唯一的、空的"第一块里:高亮块变回普通段落(显式的离开手势,内容不丢)。
  //   - 光标在非空的第一块行首:什么都不做——不能在正文开头把整个高亮块拆掉。
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {}
    return {
      ...parentShortcuts,
      // 回车:高亮块里"只有一个空段落"时,默认行为(liftEmptyBlock)会把这个空段落提出块外,
      // 块里没有内容了,高亮块就被一并删掉。改为在块内新增一行:这样回车始终是"新增一行",
      // 再按一次(此时最后一行为空,而块内已有别的段落)才按通用约定退出块外,高亮块始终保留。
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false
        const { $from } = selection
        if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false
        const owner = $from.node($from.depth - 1)
        if (!owner || owner.type.name !== 'blockquote' || !isValidType(owner.attrs.calloutType) || owner.childCount !== 1) return false
        return editor.commands.splitBlock()
      },
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false
        const { $from } = selection
        if ($from.parentOffset !== 0) return false
        // 找到最近的、是 callout 的祖先
        let depth = -1
        for (let d = $from.depth - 1; d >= 0; d--) { const n = $from.node(d); if (n.type.name === 'blockquote' && isValidType(n.attrs.calloutType)) { depth = d; break } }
        if (depth < 0) return parentShortcuts.Backspace?.({ editor }) ?? false     // 普通引用 / 不在引用里:沿用默认
        const index = $from.index(depth)
        if ($from.depth !== depth + 1) return false          // 在更深的结构(列表、嵌套引用)里:交给它们自己处理
        if (index > 0) return editor.commands.joinBackward()   // 非首块:和前一块合并,留在高亮块里
        const callout = $from.node(depth)
        const onlyEmpty = callout.childCount === 1 && callout.firstChild.type.name === 'paragraph' && callout.firstChild.content.size === 0
        if (onlyEmpty) return editor.commands.unsetCallout() && editor.commands.lift('blockquote')   // 变回普通段落
        return true                                            // 吞掉:不拆高亮块
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      /** 把当前选区包进 callout(已在 callout 里则只改类型)。 */
      setCallout: (type = 'note') => ({ commands, editor }) => {
        if (!isValidType(type)) return false
        if (editor.isActive('blockquote')) return commands.updateAttributes('blockquote', { calloutType: type })
        return commands.wrapIn('blockquote', { calloutType: type, calloutFold: null, calloutTitle: '' })
      },
      /** 普通引用 ↔ callout。 */
      unsetCallout: () => ({ commands }) => commands.updateAttributes('blockquote', { calloutType: null, calloutFold: null, calloutTitle: '' }),
      setCalloutFold: (fold) => ({ commands }) => commands.updateAttributes('blockquote', { calloutFold: fold ?? null }),
      setCalloutTitle: (title) => ({ commands }) => commands.updateAttributes('blockquote', { calloutTitle: String(title ?? '') }),
    }
  },
})

export { canonicalType, defaultTitle }
