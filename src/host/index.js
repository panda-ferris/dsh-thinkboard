// Host 插件入口:把 BoardStore 通过"带鉴权的 HTTP 路由"给 Client,通过 tool 给 agent。
// 两条路径最终都走 service.* 同一组方法 —— 业务逻辑只写一遍。

import { homedir } from 'node:os'
import { join } from 'node:path'
import { BoardStore, StoreError, MAX_IMAGE_BYTES } from './store.js'
import { OpError } from '../core/ops.js'
import { summarize } from '../core/model.js'
import { searchBoard } from '../core/view.js'
import { imageDimensions } from './imagesize.js'
import { collapsePatch, expandPatch } from '../core/content.js'
import { groupOps, ungroupOps } from '../core/cluster.js'
import { alignOps, distributeOps, fitGroupOps, wrapInGroupOps } from '../core/arrange.js'
import { uid } from '../core/model.js'
import { registerTools } from './tools.js'

export const name = 'thinkboard'
export const inject = ['webServer', 'tools', 'connection']

const API = '/api/thinkboard'
const MAX_JSON = 4 * 1024 * 1024

/** 业务服务:UI 与 agent 共用。每个方法返回可 JSON 序列化的结果,失败抛 StoreError/OpError。 */
export function createService(store, emit) {
  const service_apply = async (id, ops) => { const r = await store.apply(id, undefined, ops); emit?.('applied', id, r.rev); return r }
  return {
    list: () => store.list(),
    create: (a) => store.create(a),
    open: (a) => store.read(a.id),
    rename: (a) => store.rename(a.id, a.title),
    duplicate: (a) => store.duplicate(a.id),
    trash: (a) => store.trash(a.id),
    async apply(a) {
      const r = await store.apply(a.id, a.baseRev, a.ops)
      emit?.('applied', a.id, r.rev)
      return r
    },
    /** 排版:产出 ops 后走同一个 apply,所以同样原子、同样可被 UI 看到。 */
    async arrange(a) {
      const { board } = await store.read(a.id)
      let ops
      if (a.kind === 'align') ops = alignOps(board, a.ids ?? [], a.mode)
      else if (a.kind === 'distribute') ops = distributeOps(board, a.ids ?? [], a.axis)
      else if (a.kind === 'fit') ops = fitGroupOps(board, a.groupId)
      else if (a.kind === 'wrap') ops = wrapInGroupOps(board, a.ids ?? [], uid('g'), { color: a.color || 'blue' })
      else if (a.kind === 'group') ops = groupOps(board, a.ids ?? [], uid('c'))
      else if (a.kind === 'ungroup') ops = ungroupOps(board, a.ids ?? [])
      else if (a.kind === 'collapse' || a.kind === 'expand') {
        const f = a.kind === 'collapse' ? collapsePatch : expandPatch
        ops = board.nodes.filter((n) => (a.ids ?? []).includes(n.id) && n.type === 'text').map((n) => ({ n, p: f(n) })).filter((x) => x.p).map(({ n, p }) => ({ op: 'updateNode', id: n.id, patch: p }))
      }
      else throw new StoreError('bad-input', `unknown arrange kind "${a.kind}"`)
      if (!ops.length) return { rev: (await store.read(a.id)).rev, changed: false, results: [] }
      const r = await service_apply(a.id, ops)
      return { rev: r.rev, changed: true, results: r.results }
    },
    async read(a) {
      const { board, rev } = await store.read(a.id)
      if (typeof a.query === 'string' && a.query.trim()) {
        // 只返回匹配的元素(含摘要),大白板里不必读全量
        const hits = searchBoard(board, a.query, { limit: a.limit ?? 30 })
        const ids = new Set(hits.filter((h) => h.kind === 'node').map((h) => h.id))
        const sum = summarize(board, { full: !!a.full })
        return { rev, id: board.id, title: board.title, query: a.query, matches: hits.map(({ id, kind, type, field, snippet }) => ({ id, kind, type, field, snippet })), nodes: sum.nodes.filter((n) => ids.has(n.id)), edges: board.edges.filter((e) => hits.some((h) => h.kind === 'edge' && h.id === e.id)) }
      }
      return { rev, ...summarize(board, { full: !!a.full }) }
    },
    /** agent:把本机图片放上白板。返回新卡片 id。图片比例由读取到的字节解析,失败则用兜底尺寸。 */
    async addImage(a) {
      const { file } = await store.importImage(a.id, a.path)
      const bytes = await store.readAsset(a.id, file)
      const natural = imageDimensions(bytes)
      const width = a.width ?? Math.min(360, natural?.w ?? 320)
      const height = a.height ?? (natural ? Math.round((width * natural.h) / natural.w) : 200)
      const node = { id: a.nodeId, type: 'image', file, width, height, ...(natural ? { natural } : {}), ...(a.caption ? { caption: a.caption } : {}), ...(a.title ? { title: a.title } : {}), ...(a.place ? { place: a.place } : {}) }
      if (Number.isFinite(a.x) && Number.isFinite(a.y)) { node.x = a.x; node.y = a.y }
      const r = await service_apply(a.id, [{ op: 'addNode', node }])
      return { rev: r.rev, id: r.results[0].id, file, width, height }
    },
    async saveImage(a) {
      const { file } = await store.saveImage(a.id, a.bytes, a.filename)
      return { file }
    },
    readAsset: (a) => store.readAsset(a.id, a.file),
  }
}

export function apply(ctx, config = {}) {
  const libraryDir = config.libraryDir || join(homedir(), 'Documents', 'DSH Whiteboards')
  const store = new BoardStore(libraryDir)
  const subscribers = new Set() // SSE 客户端
  const push = (event, id, rev) => {
    const line = `data: ${JSON.stringify({ event, id, rev })}\n\n`
    for (const res of subscribers) res.write(line)
  }
  const service = createService(store, push)

  ctx.effect(() => store.watch((id) => push('external', id)), 'thinkboard: watch library')
  registerTools(ctx, service)

  const rejected = (req, res) => {
    const code = ctx.connection.requestRejection(req)
    if (code === undefined) return false
    res.statusCode = code
    res.end()
    return true
  }
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(type === 'application/json' ? JSON.stringify(body) : body)
  }
  const readBody = async (req, limit) => {
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > limit) throw new StoreError('too-large', 'request too large')
      chunks.push(c)
    }
    return Buffer.concat(chunks)
  }
  const fail = (res, e) => {
    const known = e instanceof StoreError || e instanceof OpError
    const status = e?.code === 'not-found' ? 404 : e?.code === 'stale' ? 409 : known ? 400 : 500
    send(res, status, { error: { code: e?.code ?? (e instanceof OpError ? 'bad-op' : 'internal'), message: String(e?.message ?? e) } })
  }

  // JSON-RPC 风格:POST /api/thinkboard/rpc  { method, params }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API}/rpc`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return send(res, 405, { error: { code: 'method', message: 'POST only' } })
      try {
        const { method, params = {} } = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'))
        const fn = RPC[method]
        if (!fn) throw new StoreError('bad-method', `unknown method "${method}"`)
        send(res, 200, { result: await fn(service, params) })
      } catch (e) { fail(res, e) }
    },
  }), 'thinkboard: rpc')

  // 二进制:PUT /api/thinkboard/image?board=&name=  ·  GET /api/thinkboard/asset?board=&file=
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API}/image`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      try {
        if (req.method !== 'PUT') return send(res, 405, { error: { code: 'method', message: 'PUT only' } })
        const u = new URL(req.url, 'http://x')
        const bytes = new Uint8Array(await readBody(req, MAX_IMAGE_BYTES))
        send(res, 200, { result: await service.saveImage({ id: u.searchParams.get('board'), filename: u.searchParams.get('name') || 'image.png', bytes }) })
      } catch (e) { fail(res, e) }
    },
  }), 'thinkboard: image upload')

  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API}/asset`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      try {
        const u = new URL(req.url, 'http://x')
        const file = u.searchParams.get('file') || ''
        const bytes = await service.readAsset({ id: u.searchParams.get('board'), file })
        const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
        // svg 可含脚本:加 CSP 沙箱,禁止被当作文档执行
        res.writeHead(200, {
          'content-type': MIME[ext] ?? 'application/octet-stream',
          'cache-control': 'private, max-age=31536000, immutable',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'x-content-type-options': 'nosniff',
        })
        res.end(Buffer.from(bytes))
      } catch (e) { fail(res, e) }
    },
  }), 'thinkboard: asset')

  // 变更推送:GET /api/thinkboard/events  (text/event-stream)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API}/events`,
    handler: (req, res) => {
      if (rejected(req, res)) return
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': ok\n\n')
      subscribers.add(res)
      const beat = setInterval(() => res.write(': ping\n\n'), 25000)
      req.on('close', () => { clearInterval(beat); subscribers.delete(res) })
    },
  }), 'thinkboard: events')
  ctx.effect(() => () => { for (const r of subscribers) r.end(); subscribers.clear() }, 'thinkboard: close streams')
}

/** 允许 Client 调用的方法白名单。 */
const RPC = {
  list: (s) => s.list(),
  create: (s, p) => s.create({ title: p.title }),
  open: (s, p) => s.open({ id: p.id }),
  rename: (s, p) => s.rename({ id: p.id, title: p.title }),
  duplicate: (s, p) => s.duplicate({ id: p.id }),
  trash: (s, p) => s.trash({ id: p.id }),
  apply: (s, p) => s.apply({ id: p.id, baseRev: p.baseRev, ops: p.ops }),
}
