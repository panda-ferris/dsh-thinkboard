// Client 入口(esbuild 打包为 window.__ModuleLoader__ 的 CommonJS 模块形态)。
// 必须导出 apply / inject:运行时用到的 ctx 服务都要在 inject 里声明。

import React from 'react'
import { Panel } from './panel.js'
import { createStore } from './store.js'
import { createReferenceSource } from './refsource.js'
import { createFocusBus } from './focusbus.js'
import { transport } from './transport.js'
import css from './styles.css'

const h = React.createElement
const PANEL_ID = 'thinkboard'
const NS = 'thinkboard'

export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'uiWorkspace', 'workspaces', 'inputTriggers']

function Icon({ size = 16 }) {
  return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
    h('rect', { x: 6.5, y: 8, width: 5, height: 4, rx: 1 }),
    h('rect', { x: 13.5, y: 13, width: 4, height: 4, rx: 1 }),
    h('path', { d: 'M11.5 10h2a2 2 0 0 1 2 2v1' }))
}

// 嵌入对话:与 dsh 自带子代理侧栏聊天同构
function EmbeddedConversation({ useSession, renderFactorySlot }) {
  const session = useSession((v) => v)
  const hero = !!session.blank
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: hero ? 'hero' : 'active', hero }, {})
}

export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  const onErrorRef = { current: () => {} }
  const store = createStore({ transport, onError: (e) => onErrorRef.current(e) })
  store.onErrorRef = onErrorRef

  // 全局只注入一次样式
  const style = document.createElement('style')
  style.setAttribute('data-wb-style', '')
  style.textContent = css
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'thinkboard: style')

  ctx.effect(() => ctx.locale.register(NS, {
    zh: ZH, en: EN,
  }), 'thinkboard: locale')

  const focusBus = createFocusBus()

  // ---- 输入框里的"白板元素引用":点击聚焦、发送时转成模型可读的文本 ----
  // 外观借用 dsh 的"会话"图标(dsh 只允许 session / file / folder 三种)。
  const inputTriggers = ctx.get('inputTriggers')
  const source = createReferenceSource({
    getBoard: () => store.getState().board,
    openBoard: async (id) => (await transport.open(id)).board,
    focusBus, t,
  })
  ctx.effect(() => inputTriggers.registerSource(source), 'thinkboard: @ reference source')

  const register = ctx.slots.register.bind(ctx.slots)
  const mount = ctx.slots.inject.bind(ctx.slots)
  mount('main', () => register({
    name: 'main', key: PANEL_ID,
    inject: () => ({ store, transport, t, ctx, focusBus }),
    children: { 'thinkboard.chat': { kind: 'single', scope: 'session' } },
  }, Panel))
  mount('thinkboard.chat', () => register({ name: 'thinkboard.chat' }, EmbeddedConversation))
  mount('sidebar.panellist', () => register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 15, label: () => t('panel'),
  }, Icon))
}

const ZH = {
  'chatref.section': '白板元素', 'chatref.attached': '已把 {count} 个元素加入输入框', 'chatref.blocked': '输入框正在发送,稍后再试', 'chatref.focusMissing': '这个元素已不在白板上',
  'tool.panel': '工具栏', 'tool.zoom': '缩放比例',
  'title.edit': '白板标题', 'title.hint': '双击修改标题', 'minimap.open': '展开小地图', 'minimap.close': '收起小地图',
  'cluster.group': '组合', 'cluster.ungroup': '取消组合', 'cluster.enter': '双击进入组合',
  'node.groupPlaceholder': '框标题(点击编辑)', 'node.groupEditHint': '双击编辑标题', 'node.groupCount': '框内有 {count} 个元素', 'node.dropHint': '松手放入框中({count})', 'node.leaveHint': '松手移出框',
  'tool.select': '选择 (V)', 'tool.shape': '图形', 'tool.textBox': '文本 (T)', 'tool.cardTool': '卡片 (N)',
  'shape.rect': '矩形', 'shape.roundRect': '圆角矩形', 'shape.ellipse': '椭圆', 'shape.diamond': '菱形(判断)', 'shape.parallelogram': '平行四边形(输入/输出)',
  'shape.trapezoid': '梯形', 'shape.cylinder': '圆柱(数据库)', 'shape.document': '文档', 'shape.terminator': '起止', 'shape.triangle': '三角形',
  'shape.hexagon': '六边形(准备)', 'shape.pentagon': '五边形', 'shape.star': '星形', 'shape.arrowRight': '箭头', 'shape.bubble': '气泡',
  'shape.hint': '点击后在画布上点击放置,或拖拽画出大小;也可直接把图形拖到画布上。Esc 退出。', 'shape.textPlaceholder': '输入文字', 'shape.quickAdd': '生成相连的图形',
  'style.fill': '填充', 'style.stroke': '边框', 'style.text': '文字', 'style.solid': '实线', 'style.dashed': '虚线', 'style.dotted': '点线',
  'style.align.left': '左', 'style.align.center': '中', 'style.align.right': '右',
  'edge.route.curve': '曲线', 'edge.route.orthogonal': '折线', 'edge.route.straight': '直线', 'edge.ends': '端点', 'edge.start': '起点', 'edge.endLabel': '终点',
  'edge.end.none': '无', 'edge.end.arrow': '箭头', 'edge.end.dot': '圆点',
  'color.none': '无', 'color.default': '默认', 'color.gray': '灰', 'color.red': '红', 'color.orange': '橙', 'color.yellow': '黄', 'color.green': '绿', 'color.blue': '蓝', 'color.purple': '紫',
  panel: '白板',
  'list.title': '白板', 'list.new': '新建白板', 'list.search': '搜索', 'list.empty': '还没有白板', 'list.noMatch': '没有匹配的白板',
  'list.untitled': '未命名白板', 'list.toggle': '显示/隐藏列表',
  'menu.rename': '重命名', 'menu.duplicate': '复制', 'menu.delete': '删除(移入回收站)', 'menu.deleteConfirm': '删除这张白板?文件会移入库目录下的 .trash,可手动恢复。',
  'tool.card': '+ 卡片', 'tool.html': '+ HTML', 'tool.htmlHint': '新建 HTML 卡片(在沙箱中显示)',
  'image.preview': '放大查看', 'image.replace': '替换图片', 'image.ratio': '恢复原始比例', 'image.caption': '图片说明', 'html.edit': '编辑 HTML', 'tool.image': '+ 图片', 'tool.group': '+ 框', 'tool.undo': '撤销', 'tool.redo': '重做', 'tool.fit': '适应画面', 'tool.export': '导出 PNG', 'tool.delete': '删除',
  'search.open': '搜索 (⌘F)', 'search.placeholder': '搜索卡片、框、连线文字…', 'search.close': '关闭搜索', 'search.none': '没有匹配的内容', 'search.count': '{count} 个结果',
  'search.card': '卡片', 'search.group': '框', 'search.image': '图片', 'search.edge': '连线',
  'edge.dashed': '虚线', 'edge.arrow': '箭头',
  'arrange.left': '左对齐', 'arrange.hcenter': '水平居中', 'arrange.right': '右对齐', 'arrange.top': '顶对齐', 'arrange.vcenter': '垂直居中', 'arrange.bottom': '底对齐',
  'arrange.distX': '水平等间距', 'arrange.distY': '垂直等间距', 'arrange.wrap': '成框', 'arrange.fit': '适配内容',
  'canvas.empty': '双击画布新建卡片,拖入或粘贴图片,从卡片边缘的圆点拖出连线', 'canvas.pick': '从左侧选择一张白板',
  'node.titlePlaceholder': '标题(可选)', 'node.textPlaceholder': '输入 Markdown…', 'node.imageMissing': '图片文件缺失', 'node.captionPlaceholder': '图片说明(可选)', 'node.htmlPlaceholder': '输入 HTML(在沙箱中显示,不执行脚本)…', 'node.unknown': '暂不支持的卡片类型:{type}',
  'status.saving': '保存中…', 'status.saved': '已保存', 'status.loading': '加载中…',
  'error.stale': '白板已在别处被修改,已重新加载最新内容。',
  'chat.toggle': '对话', 'side.toggle': '侧栏',
  'fold.expand': '展开', 'fold.collapse': '折叠', 'detail.open': '详情', 'detail.tab': '详情', 'detail.close': '关闭详情', 'detail.locate': '定位',
  'detail.empty': '未选择卡片', 'detail.unsupported': '这种卡片暂不支持详情编辑', 'detail.editingHere': '正在右侧详情中编辑', 'chat.pickBoard': '先选择一张白板', 'chat.noSession': '这张白板还没有关联的对话', 'chat.newSession': '新建对话',
  'chat.orPick': '或关联已有对话', 'chat.noWorkspace': '没有可用的工作区,请先在侧栏创建一个工作区',
  'chat.selected': '已选中 {count} 个元素', 'chat.attach': '作为上下文带入输入框',
  'chat.contextHeader': '白板「{board}」(id: {id})中我选中的元素:',
}
const EN = {
  'chatref.section': 'Board elements', 'chatref.attached': 'Added {count} item(s) to the input', 'chatref.blocked': 'The input is busy sending; try again in a moment', 'chatref.focusMissing': 'This element is no longer on the board',
  'tool.panel': 'Toolbar', 'tool.zoom': 'Zoom level',
  'title.edit': 'Board title', 'title.hint': 'Double-click to rename', 'minimap.open': 'Show minimap', 'minimap.close': 'Hide minimap',
  'cluster.group': 'Group', 'cluster.ungroup': 'Ungroup', 'cluster.enter': 'Double-click to enter the group',
  'node.groupPlaceholder': 'Frame title (click to edit)', 'node.groupEditHint': 'Double-click to edit the title', 'node.groupCount': '{count} items in this frame', 'node.dropHint': 'Release to add to the frame ({count})', 'node.leaveHint': 'Release to remove from the frame',
  'tool.select': 'Select (V)', 'tool.shape': 'Shapes', 'tool.textBox': 'Text (T)', 'tool.cardTool': 'Card (N)',
  'shape.rect': 'Rectangle', 'shape.roundRect': 'Rounded rectangle', 'shape.ellipse': 'Ellipse', 'shape.diamond': 'Diamond (decision)', 'shape.parallelogram': 'Parallelogram (I/O)',
  'shape.trapezoid': 'Trapezoid', 'shape.cylinder': 'Cylinder (database)', 'shape.document': 'Document', 'shape.terminator': 'Terminator', 'shape.triangle': 'Triangle',
  'shape.hexagon': 'Hexagon (preparation)', 'shape.pentagon': 'Pentagon', 'shape.star': 'Star', 'shape.arrowRight': 'Arrow', 'shape.bubble': 'Speech bubble',
  'shape.hint': 'Pick one, then click on the canvas to place it or drag to size it. You can also drag a shape onto the canvas. Esc to exit.', 'shape.textPlaceholder': 'Type text', 'shape.quickAdd': 'Add a connected shape',
  'style.fill': 'Fill', 'style.stroke': 'Border', 'style.text': 'Text', 'style.solid': 'Solid', 'style.dashed': 'Dashed', 'style.dotted': 'Dotted',
  'style.align.left': 'Left', 'style.align.center': 'Center', 'style.align.right': 'Right',
  'edge.route.curve': 'Curved', 'edge.route.orthogonal': 'Elbow', 'edge.route.straight': 'Straight', 'edge.ends': 'Endpoints', 'edge.start': 'Start', 'edge.endLabel': 'End',
  'edge.end.none': 'None', 'edge.end.arrow': 'Arrow', 'edge.end.dot': 'Dot',
  'color.none': 'None', 'color.default': 'Default', 'color.gray': 'Gray', 'color.red': 'Red', 'color.orange': 'Orange', 'color.yellow': 'Yellow', 'color.green': 'Green', 'color.blue': 'Blue', 'color.purple': 'Purple',
  panel: 'Whiteboard',
  'list.title': 'Whiteboards', 'list.new': 'New whiteboard', 'list.search': 'Search', 'list.empty': 'No whiteboards yet', 'list.noMatch': 'No matches',
  'list.untitled': 'Untitled', 'list.toggle': 'Toggle list',
  'menu.rename': 'Rename', 'menu.duplicate': 'Duplicate', 'menu.delete': 'Delete (move to trash)', 'menu.deleteConfirm': 'Delete this whiteboard? Its folder is moved to .trash inside the library and can be restored manually.',
  'tool.card': '+ Card', 'tool.html': '+ HTML', 'tool.htmlHint': 'New HTML card (shown in a sandbox)',
  'image.preview': 'View larger', 'image.replace': 'Replace image', 'image.ratio': 'Restore aspect ratio', 'image.caption': 'Caption', 'html.edit': 'Edit HTML', 'tool.image': '+ Image', 'tool.group': '+ Frame', 'tool.undo': 'Undo', 'tool.redo': 'Redo', 'tool.fit': 'Fit', 'tool.export': 'Export PNG', 'tool.delete': 'Delete',
  'search.open': 'Search (⌘F)', 'search.placeholder': 'Search cards, frames, connection labels…', 'search.close': 'Close search', 'search.none': 'No matches', 'search.count': '{count} results',
  'search.card': 'Card', 'search.group': 'Frame', 'search.image': 'Image', 'search.edge': 'Edge',
  'edge.dashed': 'Dashed', 'edge.arrow': 'Arrow',
  'arrange.left': 'Align left', 'arrange.hcenter': 'Center horizontally', 'arrange.right': 'Align right', 'arrange.top': 'Align top', 'arrange.vcenter': 'Center vertically', 'arrange.bottom': 'Align bottom',
  'arrange.distX': 'Distribute horizontally', 'arrange.distY': 'Distribute vertically', 'arrange.wrap': 'Frame them', 'arrange.fit': 'Fit to content',
  'canvas.empty': 'Double-click to add a card, drop or paste images, drag from the dots on a card edge to connect', 'canvas.pick': 'Pick a whiteboard on the left',
  'node.titlePlaceholder': 'Title (optional)', 'node.textPlaceholder': 'Type Markdown…', 'node.imageMissing': 'Image file missing', 'node.captionPlaceholder': 'Caption (optional)', 'node.htmlPlaceholder': 'Type HTML (shown in a sandbox, scripts are not run)…', 'node.unknown': 'Unsupported card type: {type}',
  'status.saving': 'Saving…', 'status.saved': 'Saved', 'status.loading': 'Loading…',
  'error.stale': 'This whiteboard was changed elsewhere; the latest version has been reloaded.',
  'chat.toggle': 'Chat', 'side.toggle': 'Side panel',
  'fold.expand': 'Expand', 'fold.collapse': 'Collapse', 'detail.open': 'Details', 'detail.tab': 'Details', 'detail.close': 'Close details', 'detail.locate': 'Locate',
  'detail.empty': 'No card selected', 'detail.unsupported': 'Details are not available for this card type', 'detail.editingHere': 'Editing in the details panel', 'chat.pickBoard': 'Pick a whiteboard first', 'chat.noSession': 'This whiteboard has no linked chat yet', 'chat.newSession': 'New chat',
  'chat.orPick': 'Or link an existing chat', 'chat.noWorkspace': 'No workspace available; create one in the sidebar first',
  'chat.selected': '{count} selected', 'chat.attach': 'Add as context to the input',
  'chat.contextHeader': 'Selected elements in whiteboard "{board}" (id: {id}):',
}
