// 编辑器的 slash 命令:命令执行、图片上传与插入。纯编辑器操作,不含界面。
// 被卡片内编辑器和详情面板编辑器共用。

import { clampTableSize, isImageFile } from '../core/slash.js'
import { isValidType } from '../core/callout.js'

/** 在光标处删掉 "/查询" 再执行命令。slash = { from, to }(文档位置)。 */
export function runCommand(editor, slash, id, extra) {
  const chain = () => editor.chain().focus().deleteRange({ from: slash.from, to: slash.to })
  switch (id) {
    case 'table': {
      const { rows, cols } = clampTableSize(extra?.rows, extra?.cols)
      return chain().insertTable({ rows, cols, withHeaderRow: true }).run()
    }
    case 'h1': return chain().setNode('heading', { level: 1 }).run()
    case 'h2': return chain().setNode('heading', { level: 2 }).run()
    case 'h3': return chain().setNode('heading', { level: 3 }).run()
    case 'bullet': return chain().toggleBulletList().run()
    case 'ordered': return chain().toggleOrderedList().run()
    case 'task': return chain().toggleTaskList().run()
    case 'quote': return chain().toggleBlockquote().run()
    case 'callout': return chain().setCallout(isValidType(extra?.type) ? extra.type : 'note').run()
    case 'highlight': return chain().toggleHighlight().run()
    case 'code': return chain().toggleCodeBlock().run()
    case 'divider': return chain().setHorizontalRule().run()
    default: return false
  }
}

/**
 * 选择并插入图片:弹出文件选择,上传到白板的 assets/,再在光标处插入。
 * upload(file) → 'assets/<name>'。返回 Promise<boolean>。
 * 上传期间编辑器内容可能变化,所以先记住"插入点"的标记位置(用 slash 的 from),
 * 上传完成后若位置已失效,就插在当前光标处,不丢图。
 */
export function insertImages(editor, files, upload, urlFor, at) {
  const list = [...files].filter(isImageFile)
  if (!list.length) return Promise.resolve(0)
  return (async () => {
    let n = 0
    for (const f of list) {
      try {
        const path = await upload(f)
        const alt = (f.name || '').replace(/\.[^.]+$/, '')
        const node = { type: 'image', attrs: { src: urlFor(path), alt, assetPath: path } }
        const c = editor.chain().focus()
        if (n === 0 && at != null && at <= editor.state.doc.content.size) c.insertContentAt(at, node)
        else c.insertContent(node)
        c.run()
        n++
      } catch { /* 单张失败不影响其它:调用方通过返回的数量得知 */ }
    }
    return n
  })()
}

/** 弹出系统文件选择(只接受图片)。选择后 resolve 文件数组;取消 resolve 空数组。 */
export function pickImageFiles() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true
    input.setAttribute('data-wb-slash-file', '')
    document.body.appendChild(input)
    const done = (files) => { input.remove(); resolve(files) }
    input.addEventListener('change', () => done([...input.files]))
    input.addEventListener('cancel', () => done([]))
    input.click()
  })
}
