// 白板存储:库目录里一张白板 = 一个子目录。
//
//   <library>/<boardId>/board.json     稳定序列化的白板
//   <library>/<boardId>/assets/<sha256前16位>.<ext>
//   <library>/.trash/<boardId>-<时间戳>/   删除即移入回收站
//
// 与 dsh 无关,只依赖 node:fs,可独立测试。
// 并发与冲突:每张白板带单调递增的 rev(从 board.json 内容的 mtime+size 之外另存于内存),
// 写入走"读-改-写"并串行化;外部改动由 watch 通知上层重新加载。

import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises'
import { watch, existsSync } from 'node:fs'
import { join, resolve, sep, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createBoard, normalizeBoard, serializeBoard, uid } from '../core/model.js'
import { applyOps, ensureIds } from '../core/ops.js'

const digest = (text) => createHash('sha256').update(text).digest('hex')
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export class StoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export class BoardStore {
  constructor(libraryDir) {
    if (!libraryDir) throw new StoreError('config', 'libraryDir is required')
    this.root = resolve(libraryDir)
    this.locks = new Map()
    this.revs = new Map() // boardId -> number,仅本进程内用于乐观并发
    this.written = new Map() // boardId -> 本进程最后写入内容的哈希,用来区分"自己写的"与"外部改的"
  }

  // ---- 路径 ----
  dir(id) {
    if (!ID_RE.test(id)) throw new StoreError('bad-id', `invalid board id "${id}"`)
    return join(this.root, id)
  }
  file(id) { return join(this.dir(id), 'board.json') }

  // ---- 列表 / 读 ----
  async list() {
    await mkdir(this.root, { recursive: true })
    const out = []
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue
      try {
        const [raw, st] = await Promise.all([readFile(join(this.root, e.name, 'board.json'), 'utf8'), stat(join(this.root, e.name, 'board.json'))])
        const b = JSON.parse(raw)
        out.push({ id: e.name, title: typeof b.title === 'string' ? b.title : e.name, nodeCount: Array.isArray(b.nodes) ? b.nodes.length : 0, updatedAt: st.mtimeMs })
      } catch {
        out.push({ id: e.name, title: e.name, nodeCount: 0, updatedAt: 0, broken: true })
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(id) {
    let raw
    try { raw = await readFile(this.file(id), 'utf8') } catch (e) {
      if (e.code === 'ENOENT') throw new StoreError('not-found', `board "${id}" not found`)
      throw e
    }
    let board
    try { board = normalizeBoard(JSON.parse(raw)) } catch (e) {
      throw new StoreError('corrupt', `board "${id}" is unreadable: ${e.message}`)
    }
    if (board.id !== id) board = { ...board, id }
    return { board, rev: this.revs.get(id) ?? 0 }
  }

  // ---- 写 ----
  async create({ title } = {}) {
    await mkdir(this.root, { recursive: true })
    const board = createBoard({ id: uid('b'), title: title?.trim() || 'Untitled' })
    await this.write(board)
    this.revs.set(board.id, 1)
    return { board, rev: 1 }
  }

  /** 在串行锁内:读 → applyOps → 原子写。baseRev 不符时拒绝(客户端需先重新加载)。 */
  apply(id, baseRev, ops) {
    return this.locked(id, async () => {
      const cur = await this.read(id)
      const have = this.revs.get(id) ?? 0
      if (baseRev !== undefined && baseRev !== null && baseRev !== have) {
        throw new StoreError('stale', `board changed (have rev ${have}, got ${baseRev}); reload and retry`)
      }
      const withIds = ensureIds(ops)
      const { board, results } = applyOps(cur.board, withIds)
      await this.write(board)
      const rev = have + 1
      this.revs.set(id, rev)
      return { board, rev, ops: withIds, results }
    })
  }

  rename(id, title) { return this.apply(id, undefined, [{ op: 'setTitle', title }]) }

  async duplicate(id) {
    const { board } = await this.read(id)
    const copy = { ...board, id: uid('b'), title: `${board.title} copy` }
    await this.write(copy)
    // 图片资源整体复制
    try {
      const { cp } = await import('node:fs/promises')
      await cp(join(this.dir(id), 'assets'), join(this.dir(copy.id), 'assets'), { recursive: true })
    } catch (e) { if (e.code !== 'ENOENT') throw e }
    this.revs.set(copy.id, 1)
    return { board: copy, rev: 1 }
  }

  async trash(id) {
    const src = this.dir(id)
    const dst = join(this.root, '.trash', `${id}-${Date.now()}`)
    await mkdir(join(this.root, '.trash'), { recursive: true })
    await rename(src, dst)
    this.revs.set(id, (this.revs.get(id) ?? 0) + 1)
    return { trashedTo: dst }
  }

  async write(board) {
    const dir = this.dir(board.id)
    await mkdir(dir, { recursive: true })
    const f = join(dir, 'board.json')
    const tmp = `${f}.${process.pid}.tmp`
    const text = serializeBoard(board)
    this.written.set(board.id, digest(text))
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, f)
  }

  // ---- 图片资源 ----
  async saveImage(id, bytes, filename = 'image.png') {
    if (!(bytes instanceof Uint8Array)) throw new StoreError('bad-input', 'bytes required')
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new StoreError('too-large', `image exceeds ${MAX_IMAGE_BYTES} bytes`)
    const ext = extname(filename).toLowerCase()
    if (!IMG_EXT.has(ext)) throw new StoreError('bad-type', `unsupported image type "${ext}"`)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const rel = `assets/${hash}${ext}`
    const abs = join(this.dir(id), rel)
    await mkdir(join(this.dir(id), 'assets'), { recursive: true })
    try { await stat(abs) } catch { await writeFile(abs, bytes) } // 同内容只存一份
    return { file: rel }
  }

  /** 从本机路径导入图片(agent 用)。只读该文件;类型/大小与 saveImage 同一套限制。 */
  async importImage(id, srcPath) {
    const abs = resolve(String(srcPath))
    let st
    try { st = await stat(abs) } catch { throw new StoreError('not-found', `file not found: ${srcPath}`) }
    if (!st.isFile()) throw new StoreError('bad-input', `not a regular file: ${srcPath}`)
    if (st.size > MAX_IMAGE_BYTES) throw new StoreError('too-large', `image exceeds ${MAX_IMAGE_BYTES} bytes`)
    const bytes = new Uint8Array(await readFile(abs))
    return this.saveImage(id, bytes, abs)
  }

  async readAsset(id, rel) {
    const abs = resolve(this.dir(id), rel)
    const assets = resolve(this.dir(id), 'assets') + sep
    if (!abs.startsWith(assets)) throw new StoreError('forbidden', 'path escapes assets directory')
    try { return new Uint8Array(await readFile(abs)) } catch (e) {
      if (e.code === 'ENOENT') throw new StoreError('not-found', `asset "${rel}" not found`)
      throw e
    }
  }

  // ---- 监听外部改动 ----
  /** onChange(boardId | null):null 表示库目录结构变化。去抖 150ms;本进程自己写入的内容(哈希一致)不会通知。 */
  watch(onChange) {
    let timer
    const pending = new Set()
    const flush = async () => {
      const ids = [...pending]
      pending.clear()
      for (const id of ids) {
        if (id === null) { onChange(null); continue }
        let h = null
        try { h = digest(await readFile(this.file(id), 'utf8')) } catch { /* 被删除或移走:照常通知 */ }
        if (h !== null && h === this.written.get(id)) continue // 自己刚写的,不是外部改动
        this.written.delete(id)
        this.revs.set(id, (this.revs.get(id) ?? 0) + 1) // 外部改动使客户端持有的 rev 失效(只增不减)
        onChange(id)
      }
    }
    let w
    mkdir(this.root, { recursive: true }).then(() => {
      w = watch(this.root, { recursive: true }, (_t, file) => {
        if (!file) return
        const parts = String(file).split(sep).filter(Boolean)
        // 个别平台会把库根目录自身当作变化条目上报
        if (parts.length === 1 && parts[0] === basename(this.root)) return
        const [first, second] = parts
        // 只关心 <library>/<boardId>/board.json* 与 <library>/<boardId> 目录本身的出现/消失
        if (!first || first.startsWith('.') || !ID_RE.test(first)) return
        if (parts.length >= 2 && !String(second).startsWith('board.json')) return
        if (parts.length === 2 && String(second).endsWith('.tmp')) return // 原子写的临时文件
        // 顶层目录事件:确实是白板目录才算(根目录自身/杂项目录不算)
        if (parts.length === 1 && !existsSync(join(this.root, first, 'board.json'))) return
        pending.add(first)
        clearTimeout(timer)
        timer = setTimeout(() => { flush().catch(() => {}) }, 150)
      })
    }).catch(() => {})
    return () => { clearTimeout(timer); w?.close() }
  }

  locked(id, fn) {
    const prev = this.locks.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(id, next.catch(() => {}))
    return next
  }
}
