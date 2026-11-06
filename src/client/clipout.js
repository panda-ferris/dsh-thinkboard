// 复制出去的 HTML:把编辑器里的结构降级成外部软件(飞书、KM、Word、Obsidian)都认识的写法。
// 做法:拿到 ProseMirror 序列化出的 DOM 片段,就地改写(只改外观相关的部分),不动文字内容。
//   - 高亮块:用引用块 + 内联样式(颜色、左边框、底色)
//   - 表格:加边框和表头底色的内联样式(外部软件常常丢弃 class,没有边框的表格粘过去看不出是表格)
//   - 高亮 <mark>:加内联背景色
//   - 图片:远程保留;小的本地图片内嵌 data URL;过大的降级成文字,避免剪贴板里塞进几 MB 的字符串
// 纯 DOM 操作,依赖 core/clipboard.js 里的样式常量与决策。

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { calloutToExternalHtml, TABLE_STYLE, CELL_STYLE, HEAD_STYLE, MARK_STYLE, imageDecision, INLINE_IMAGE_MAX } from '../core/clipboard.js'

/** 同步地把已加载好的 <img> 画成 data URL(只能处理同源/已加载成功的图片)。失败返回 null。 */
function imgToDataUrl(img) {
  try {
    if (!img.complete || !img.naturalWidth) return null
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    const url = c.toDataURL('image/png')
    return url.length <= INLINE_IMAGE_MAX * 1.4 ? url : null
  } catch { return null }   // 跨域污染画布等
}

/** 就地改写一个 DOM 片段(DocumentFragment 或元素),返回它自己。 */
export function externalize(root) {
  const doc = root.ownerDocument || document
  // 1) 高亮块 → 引用块
  root.querySelectorAll('div.wb-callout').forEach((el) => {
    const title = el.querySelector('.wb-callout-title-text')?.textContent?.trim() || ''
    const body = el.querySelector('.wb-callout-body')?.innerHTML || ''
    const holder = doc.createElement('div')
    holder.innerHTML = calloutToExternalHtml({ color: el.getAttribute('data-callout-color') || 'blue', title, bodyHtml: body, type: el.getAttribute('data-callout') || '', fold: el.getAttribute('data-fold') })
    el.replaceWith(holder.firstChild)
  })
  // 2) 表格:去掉我们的 colgroup/包装,加内联边框
  root.querySelectorAll('div.tableWrapper').forEach((w) => { const t = w.querySelector('table'); if (t) w.replaceWith(t) })
  root.querySelectorAll('table').forEach((t) => {
    t.removeAttribute('class'); t.setAttribute('style', TABLE_STYLE); t.setAttribute('border', '1'); t.setAttribute('cellspacing', '0')
    t.querySelectorAll('colgroup').forEach((c) => c.remove())
    t.querySelectorAll('th').forEach((c) => { c.setAttribute('style', HEAD_STYLE + (c.style.textAlign ? `;text-align:${c.style.textAlign}` : '')) })
    t.querySelectorAll('td').forEach((c) => { c.setAttribute('style', CELL_STYLE + (c.style.textAlign ? `;text-align:${c.style.textAlign}` : '')) })
  })
  // 3) 高亮
  root.querySelectorAll('mark').forEach((m) => m.setAttribute('style', MARK_STYLE))
  // 4) 图片
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    const d = imageDecision(src)
    if (d === 'keep') return
    if (d === 'inline') {
      // 页面里的这张图片(同源资源地址)已经渲染好了,直接取像素
      const live = [...document.images].find((x) => x.src === img.src || x.getAttribute('src') === src)
      const url = live ? imgToDataUrl(live) : null
      if (url) { img.setAttribute('src', url); return }
    }
    const alt = img.getAttribute('alt') || '图片'
    img.replaceWith(doc.createTextNode(`[${alt}]`))
  })
  // 5) 清理只对编辑器有意义的属性
  // data-pm-slice 是 ProseMirror 在序列化之后才加到第一个顶层元素上的(用于"粘回本编辑器时保留切片边界"),
  // 这里清不掉也不必清:它是无害的普通属性,外部软件会忽略;粘回我们自己的编辑器时它还有用。
  root.querySelectorAll('[contenteditable],[data-wb-ui]').forEach((e) => { e.removeAttribute('contenteditable'); e.removeAttribute('data-wb-ui') })
  root.querySelectorAll('a[target]').forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel') })
  return root
}

/** 给 ProseMirror 的 clipboardSerializer 用:在默认序列化结果上套一层 externalize。 */
export function wrapSerializer(base) {
  return {
    serializeFragment: (fragment, options, target) => {
      const out = base.serializeFragment(fragment, options, target)
      externalize(out)
      return out
    },
    serializeNode: (node, options) => base.serializeNode(node, options),
  }
}


// ---------------- 复制:纯文本写 Markdown,HTML 写外部能认的结构 ----------------
/**
 * 编辑器的复制行为:
 *   text/plain —— 选区对应的 Markdown 源码(而不是 Tiptap 默认的"把文字拼起来"):
 *                 粘到 Obsidian、代码编辑器、IM 里能还原标题、列表、表格、高亮块。
 *   text/html  —— 套 externalize:高亮块变带底色的引用、表格带边框、小图片内嵌,飞书/KM/Word 粘过去看得出结构。
 * 优先级高于 Tiptap 自带的 clipboardTextSerializer(它先注册,同一个 prop 取第一个返回值)。
 */
export const ClipboardOut = Extension.create({
  name: 'wbClipboardOut',
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: new PluginKey('wbClipboardOut'),
      props: {
        clipboardSerializer: wrapSerializer(DOMSerializer.fromSchema(editor.schema)),
        clipboardTextSerializer: (slice) => {
          try {
            // 把选区切片变成文档再序列化成 Markdown
            const doc = editor.schema.topNodeType.createAndFill(null, slice.content)
            if (!doc) return ''
            // 块与块之间统一用一个空行(表格等块自带前后换行,会多出空行)
            return editor.markdown.serialize(doc.toJSON()).trim().replace(/\n{3,}/g, '\n\n')
          } catch { return slice.content.textBetween(0, slice.content.size, '\n\n') }
        },
      },
    })]
  },
})
