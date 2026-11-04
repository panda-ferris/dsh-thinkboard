// agent 工具:与 UI 共用 service,不另写业务逻辑。只有两个工具:读与写。
//
// 不依赖 @deepseek-ai/dsh-tools(第三方包位置解析不到它):工具定义就是一个朴素对象,
// 结构与 defineTool 的产出一致。参数校验自己做,失败时抛出带原因的错误,框架会把它变成普通工具错误。

const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
const output = {
  schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
  render: (_args, value) => text(value.result),
}

function check(args, spec) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object')
  for (const [k, v] of Object.entries(args)) {
    const s = spec[k]
    if (!s) throw new Error(`unknown argument "${k}"`)
    if (v === undefined || v === null) continue
    const ok = s === 'array' ? Array.isArray(v) : typeof v === s
    if (!ok) throw new Error(`argument "${k}" must be a ${s}`)
  }
}

export function registerTools(ctx, service) {
  const readTool = {
    name: 'thinkboard_read',
    description:
      'Read whiteboards. Without `board`, lists all boards (id, title, node count). With `board`, returns that board: ' +
      'nodes (id, type text|image|group, x, y, width, height, title, text, color), edges (id, fromNode, toNode, label) and its current `rev`. ' +
      'Coordinates are canvas pixels, origin top-left. A node whose center lies inside a group node belongs to that group. ' +
      'Set `full: true` to get complete card text instead of a 200-character preview.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id from the list. Omit to list boards.' },
        full: { type: 'boolean', description: 'Return complete card text.' },
        query: { type: 'string', description: 'With `board`: only return elements whose title/text/label contains ALL of these space-separated words (case-insensitive), ranked by relevance. Use this on large boards instead of reading everything.' },
      },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      check(args, { board: 'string', full: 'boolean', query: 'string' })
      const r = args.board ? await service.read({ id: args.board, full: args.full, query: args.query }) : await service.list()
      return { result: JSON.stringify(r) }
    },
  }

  const editTool = {
    name: 'thinkboard_edit',
    description:
      'Edit a whiteboard with a batch of operations, applied atomically (if any op is invalid nothing changes). ' +
      'Use action "create" to make a new board first. Use action "add_image" with `path` (an absolute image path on this machine: png/jpg/gif/webp/svg, max 20MB) to put an image card on the board; optional caption, title, x, y, width, height, place. For layout use action "arrange" with `kind`: ' +
      '"align" {ids, mode: left|hcenter|right|top|vcenter|bottom}, "distribute" {ids, axis: x|y} (needs 3+), "fit" {groupId} (resize a group to hug its cards), ' +
      '"wrap" {ids, color?} (put cards into a new frame), "collapse"/"expand" {ids} (fold long text cards to a short preview, or restore them), ' +
      '"group" {ids} (combine 2+ elements so they select/move/scale/copy as one; a node\'s `cluster` field lists its groups outer→inner joined by "/"; unlike a frame a group has no title or background), "ungroup" {ids} (dissolve the outermost group of the given elements). Ops (field `op`): ' +
      'addNode {node:{type:"text"|"html"|"shape"|"group", title?, text?(markdown, for text), html?(for html: shown in a sandbox, scripts and network are blocked, max 200KB), ' +
      'kind?(for shape: rect|roundRect|ellipse|diamond|parallelogram|trapezoid|cylinder|document|terminator|triangle|hexagon|pentagon|star|arrowRight|bubble|text), ' +
      'text?(plain label for shapes), fill?/stroke?(color name: gray,red,orange,yellow,green,blue,purple, or "none"), dash?(solid|dashed|dotted), strokeWidth?, fontSize?, align?(left|center|right), ' +
      'color?, x?,y?,width?,height?, place?:{rightOf|leftOf|below|above:<nodeId>, gap?}}} — shapes get a sensible default size per kind; ' +
      'for flowcharts use terminator for start/end, rect for steps, diamond for decisions, parallelogram for input/output, cylinder for databases — ' +
      'omit x/y to auto-place, or use `place` to position relative to another node; for a group use `label` instead of `title`; ' +
      'updateNode {id, patch} (set a field to null to remove it); moveNodes {ids, dx, dy} (moving a frame also moves the cards inside it, so list the frame and its contents in ONE moveNodes op — a card listed in a second op would move twice); ' +
      'removeNodes {ids}; addEdge {edge:{fromNode, toNode, fromSide?/toSide?(top|right|bottom|left), label?, dashed?, color?, route?(curve|orthogonal|straight; use orthogonal for flowcharts), bend?(number, px: shifts the middle segment of an orthogonal edge sideways, e.g. to route around a shape), startEnd?/endEnd?(none|arrow|dot)}}; updateEdge {id, patch}; removeEdges {ids}; setTitle {title}. ' +
      'A shape is connected at the middle of its sides; to lay out a flowchart top-down place each step with place:{below:<prevId>, gap:60} and connect bottom→top, branching with rightOf. ' +
      'Group colors: gray, red, orange, yellow, green, blue, purple. Keep cards concise; leave about 40px between cards. ' +
      'Read the board first (thinkboard_read) so you do not overlap existing content.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '"apply" (default) to run ops; "create" to create a board (uses `title`); "rename" to rename (uses `title`); "arrange" for layout (uses `kind`).' },
        kind: { type: 'string', description: 'For action "arrange": align | distribute | fit | wrap | collapse | expand.' },
        path: { type: 'string', description: 'For action "add_image": absolute path of a local image file.' },
        caption: { type: 'string', description: 'For action "add_image": optional caption shown under the image.' },
        x: { type: 'number', description: 'For add_image: optional x.' },
        y: { type: 'number', description: 'For add_image: optional y.' },
        width: { type: 'number', description: 'For add_image: optional width in canvas pixels (height follows the aspect ratio).' },
        place: { type: 'object', additionalProperties: true, description: 'For add_image: relative placement, e.g. {rightOf:"<nodeId>", gap:40}.' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Node ids for arrange align/distribute/wrap.' },
        mode: { type: 'string', description: 'For arrange align: left|hcenter|right|top|vcenter|bottom.' },
        axis: { type: 'string', description: 'For arrange distribute: x or y.' },
        groupId: { type: 'string', description: 'For arrange fit: the group to resize.' },
        color: { type: 'string', description: 'For arrange wrap: group color.' },
        board: { type: 'string', description: 'Board id (not needed for "create").' },
        title: { type: 'string', description: 'Title for create/rename.' },
        ops: { type: 'array', description: 'Operations for "apply".', items: { type: 'object', additionalProperties: true } },
      },
    },
    output,
    async execute(args) {
      check(args, { action: 'string', board: 'string', title: 'string', ops: 'array', kind: 'string', ids: 'array', mode: 'string', axis: 'string', groupId: 'string', color: 'string', path: 'string', caption: 'string', x: 'number', y: 'number', width: 'number', place: 'object' })
      const { action = 'apply', board, title, ops } = args
      if (action === 'create') {
        const r = await service.create({ title })
        return { result: JSON.stringify({ board: r.board.id, title: r.board.title, rev: r.rev }) }
      }
      if (!board) throw new Error('`board` is required')
      if (action === 'rename') {
        const r = await service.rename({ id: board, title })
        return { result: JSON.stringify({ rev: r.rev }) }
      }
      if (action === 'add_image') {
        if (!args.path) throw new Error('`path` is required for add_image')
        const r = await service.addImage({ id: board, path: args.path, caption: args.caption, title, x: args.x, y: args.y, width: args.width, place: args.place })
        return { result: JSON.stringify(r) }
      }
      if (action === 'arrange') {
        const r = await service.arrange({ id: board, kind: args.kind, ids: args.ids, mode: args.mode, axis: args.axis, groupId: args.groupId, color: args.color })
        return { result: JSON.stringify(r) }
      }
      if (action !== 'apply') throw new Error(`unknown action "${action}"`)
      if (!Array.isArray(ops) || ops.length === 0) throw new Error('`ops` must be a non-empty array')
      const r = await service.apply({ id: board, ops })
      return { result: JSON.stringify({ rev: r.rev, results: r.results }) }
    },
  }

  for (const tool of [readTool, editTool]) ctx.effect(() => ctx.tools.register(tool), `thinkboard: tool ${tool.name}`)
}
