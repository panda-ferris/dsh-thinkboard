// 本机(浏览器)存储键的一次性迁移。
// 插件早期叫 dsh-whiteboard,本机键是 dsh.whiteboard.*;改名为 ThinkBoard 后键改为 dsh.thinkboard.*。
// 首次加载时把旧键的值搬到新键(新键已存在则不覆盖),保留"上次打开的白板、会话绑定、视口、侧栏状态"。

const OLD = 'dsh.whiteboard.'
const NEW = 'dsh.thinkboard.'

export function migrateLegacyKeys(storage = globalThis.localStorage) {
  if (!storage) return 0
  let moved = 0
  try {
    const keys = []
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(OLD)) keys.push(k) }
    for (const k of keys) {
      const nk = NEW + k.slice(OLD.length)
      if (storage.getItem(nk) === null) { storage.setItem(nk, storage.getItem(k)); moved++ }
      storage.removeItem(k)
    }
  } catch { /* 隐私模式 / 配额:忽略,功能退化为"重新开始" */ }
  return moved
}
