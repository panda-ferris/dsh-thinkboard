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
import { parseCalloutHead, formatCalloutHead, splitFirstLine, canonicalType, defaultTitle, isValidType } from '../core/callout.js'

const attr = (name, def) => ({
  default: def,
  parseHTML: (el) => el.getAttribute('data-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) ?? def,
  renderHTML: (a) => (a[name] == null || a[name] === '' ? {} : { ['data-' + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]: a[name] }),
})

export const Callout = Blockquote.extend({
  name: 'blockquote',   // 沿用 blockquote 的名字:普通引用和 callout 是同一个节点类型

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
