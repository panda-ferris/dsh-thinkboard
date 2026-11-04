// 在真实 Chrome 里验证 HTML 卡片的沙箱:即使过滤器被绕过,脚本也不能执行/联网/读宿主。
// 做法:跳过 sanitizeHtml,直接把"危险载荷"原样塞进带 sandbox + CSP 的 iframe,观察副作用。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

let hits = []
const srv = createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' }); res.end(Buffer.from('iVBORw0KGgo=', 'base64')) })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const evil = `http://127.0.0.1:${srv.address().port}`

const port = 9453
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/wb-chrome10', '--window-size=900,600', 'about:blank'], { stdio: 'ignore' })
let ws, id = 0; const pending = new Map()
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const results = []
const check = (n, ok, info = '') => { results.push(ok); console.log(ok ? '  ✔' : '  ✖', n, info) }
try {
  let t; for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(200) } }
  ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: `${evil}/` }); await sleep(500)   // 宿主页面有真实 origin,便于测"读宿主"
  await ev(`window.SECRET='host-secret'; document.cookie='sid=abc'; localStorage.setItem('k','v'); window.__pwn=0`)

  const run = async (name, inner) => {
    const csp = `default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:`
    const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">${inner}`
    await ev(`(()=>{const f=document.createElement('iframe');f.id='f';f.setAttribute('sandbox','');f.srcdoc=${JSON.stringify(doc)};document.body.appendChild(f)})()`)
    await sleep(700)
    const out = await ev(`window.__pwn`)
    await ev(`document.getElementById('f')?.remove()`)
    return out
  }

  hits = []
  let r = await run('script', `<script>parent.__pwn=1</script>`)
  check('脚本不执行(无 allow-scripts)', r === 0)
  r = await run('onerror', `<img src="x" onerror="parent.__pwn=2">`)
  check('事件属性不执行', r === 0)
  r = await run('top-nav', `<a id=a href="javascript:parent.__pwn=3">x</a><script>a.click()</script>`)
  check('javascript: 链接不执行', r === 0)
  hits = []
  await run('img', `<img src="${evil}/track.png?img"><div style="background:url(${evil}/track.png?css)">x</div>`)
  check('外部图片 / CSS url() 不发出请求(CSP)', hits.length === 0, JSON.stringify(hits))
  await run('link', `<link rel=stylesheet href="${evil}/x.css?link"><style>@import "${evil}/x.css?import";</style>`)
  check('外部样式表 / @import 不发出请求', hits.length === 0, JSON.stringify(hits))
  await run('form', `<form id=f2 action="${evil}/post?form" method=post><input name=a value=1></form><script>f2.submit()</script>`)
  check('表单提交不发出请求', hits.length === 0, JSON.stringify(hits))
  await run('meta', `<meta http-equiv="refresh" content="0;url=${evil}/refresh">`)
  check('meta refresh 不跳转', hits.length === 0, JSON.stringify(hits))
  await run('fetch', `<script>fetch("${evil}/fetch").catch(()=>{});new Image().src="${evil}/beacon"</script>`)
  check('脚本里的 fetch / 信标不发出请求', hits.length === 0, JSON.stringify(hits))
  // 读宿主:srcdoc iframe 在 sandbox 下是不透明 origin
  const probe = await ev(`(async()=>{
    const f=document.createElement('iframe');f.setAttribute('sandbox','');document.body.appendChild(f);
    let canRead=false; try{ canRead = !!f.contentWindow.document.body }catch{}
    f.remove(); return canRead })()`)
  check('宿主无法读取沙箱 iframe 的 DOM(不透明 origin)', probe === false)
  // 不带 sandbox 的对照:证明测试方法本身能测出脚本执行(否则上面的"通过"没有意义)
  await ev(`window.__pwn=0`)
  await ev(`(()=>{const f=document.createElement('iframe');f.id='ctl';f.srcdoc='<script>parent.__pwn=99</script>';document.body.appendChild(f)})()`)
  await sleep(600)
  check('对照组:无 sandbox 的 iframe 里脚本确实会执行(证明测试有效)', (await ev('window.__pwn')) === 99)
} finally { chrome.kill(); srv.close() }
const bad = results.filter((x) => !x).length
console.log(`\n${results.length - bad}/${results.length} 通过`)
process.exit(bad ? 1 : 0)
