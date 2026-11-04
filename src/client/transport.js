// Client ↔ Host 传输:带登录 cookie 的同源 fetch(浏览器自动携带),与 Host 的 rpc 白名单一一对应。

const API = '/api/thinkboard'

export class RpcError extends Error {
  constructor(code, message) { super(message); this.name = 'RpcError'; this.code = code }
}

async function rpc(method, params) {
  const res = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
  let body
  try { body = await res.json() } catch { throw new RpcError('http', `HTTP ${res.status}`) }
  if (body.error) throw new RpcError(body.error.code, body.error.message)
  return body.result
}

export const transport = {
  list: () => rpc('list', {}),
  create: (title) => rpc('create', { title }),
  open: (id) => rpc('open', { id }),
  rename: (id, title) => rpc('rename', { id, title }),
  duplicate: (id) => rpc('duplicate', { id }),
  trash: (id) => rpc('trash', { id }),
  apply: (id, baseRev, ops) => rpc('apply', { id, baseRev, ops }),
  focus: (sessionId, boardId, selection) => rpc('focus', { sessionId, boardId, selection }),
  async uploadImage(boardId, file) {
    const res = await fetch(`${API}/image?board=${encodeURIComponent(boardId)}&name=${encodeURIComponent(file.name || 'image.png')}`, { method: 'PUT', body: file })
    const body = await res.json()
    if (body.error) throw new RpcError(body.error.code, body.error.message)
    return body.result.file
  },
  assetUrl: (boardId, file) => `${API}/asset?board=${encodeURIComponent(boardId)}&file=${encodeURIComponent(file)}`,
  /** 订阅 Host 推送的变更;返回取消函数。浏览器 EventSource 会自动重连。 */
  subscribe(handler) {
    const es = new EventSource(`${API}/events`)
    es.onmessage = (e) => { try { handler(JSON.parse(e.data)) } catch { /* 忽略心跳 */ } }
    return () => es.close()
  },
}
