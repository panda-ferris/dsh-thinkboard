// "聚焦到某个元素"的请求通道。
//
// 为什么需要:点击输入框里的引用对象时,调用方(dsh 的 openReference)在面板之外,
// 此时白板面板可能还没挂载(用户在别的页面点到旧引用),也可能正显示另一块白板。
// 请求先存起来;面板挂载或白板切换后取走并执行,所以先后顺序不影响结果。

export function createFocusBus() {
  let pending = null
  const listeners = new Set()
  return {
    /** 发出请求。有面板在监听就立即通知;没有就留着等它来取。 */
    request(boardId, nodeId) {
      pending = { boardId, nodeId, at: Date.now() }
      for (const l of listeners) l()
    },
    /** 取走请求(取走即清空)。过期(>60s)的请求丢弃,避免很久以后挂载面板时突然跳走。 */
    take(maxAgeMs = 60000) {
      const p = pending
      pending = null
      return p && Date.now() - p.at <= maxAgeMs ? p : null
    },
    peek: () => pending,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}
