// 编辑器里的"白板图片":文档里存相对路径 assets/<name>,显示时映射成真实 URL。
//
// 为什么不直接存真实 URL:真实 URL 带着本机的登录路径和白板 id(/api/thinkboard/asset?board=…),
// 存进 Markdown 就不可移植(同步到别的机器、导出、被 agent 读到都是坏链接)。
//
// 做法:图片节点同时记两样东西
//   src       —— 显示用的真实 URL(只存在于编辑器内存与渲染出的 HTML 里)
//   assetPath —— 存盘用的 assets/<name>(只在是白板资源时有值)
// 序列化 Markdown 时用 assetPath 优先;远程图片(https:)没有 assetPath,原样用 src。

import Image from '@tiptap/extension-image'
import { isAssetPath } from '../core/slash.js'

let urlFor = null
/** 由面板在启动时设置:(boardId, 'assets/x.png') => 真实 URL。boardId 由当前卡片所在白板决定。 */
export function configureAssetUrls(fn) { urlFor = fn }
let currentBoard = null
export function setCurrentBoard(id) { currentBoard = id }

const resolve = (src) => (isAssetPath(src) && urlFor && currentBoard ? urlFor(currentBoard, src) : src)

export const BoardImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 存盘用的相对路径;不输出到 DOM 属性(避免污染渲染出的 HTML)
      assetPath: { default: null, rendered: false },
    }
  },
  parseMarkdown(token, helpers) {
    const href = token.href ?? ''
    const asset = isAssetPath(href) ? href : null
    return helpers.createNode('image', { src: asset ? resolve(asset) : href, alt: token.text ?? '', title: token.title ?? null, assetPath: asset })
  },
  renderMarkdown(node) {
    const a = node.attrs ?? {}
    const target = a.assetPath || a.src || ''
    const alt = (a.alt ?? '').replace(/[\[\]\n]/g, ' ')
    const title = a.title ? ` "${String(a.title).replace(/"/g, '\\"')}"` : ''
    return `![${alt}](${target}${title})`
  },
  // 粘贴/插入 HTML 时(<img src="assets/x.png">)也要识别
  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: (el) => {
        const raw = el.getAttribute('src') || ''
        const asset = isAssetPath(raw) ? raw : null
        return { src: asset ? resolve(asset) : raw, alt: el.getAttribute('alt'), title: el.getAttribute('title'), assetPath: asset }
      },
    }]
  },
})
