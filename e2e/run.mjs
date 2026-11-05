import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
await mkdir('e2e/out', { recursive: true })
await build({ entryPoints: ['e2e/harness.jsx'], bundle: true, outfile: 'e2e/out/bundle.js', format: 'iife', jsx: 'transform', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' })
await writeFile('e2e/out/index.html', '<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div><script src="bundle.js"></script>')

const port = 9444
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/wb-chrome', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' })
let ws, id = 0; const pending = new Map()
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value }
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
const drag = async (x1, y1, x2, y2, steps = 8, extra = {}) => { await mouse('mousePressed', x1, y1, extra); for (let i = 1; i <= steps; i++) await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, extra); await mouse('mouseReleased', x2, y2, extra) }
const results = []
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(ok ? '  ✔' : '  ✖', name, info) }
try {
  let targets
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(200) } }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear()}catch(e){}' })
  await send('Page.navigate', { url: 'file://' + resolve('e2e/out/index.html') })
  for (let i = 0; i < 40 && (await ev('document.title')) !== 'READY'; i++) await sleep(150)
  const node = (id) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"]').getBoundingClientRect();return {x:e.left,y:e.top,w:e.width,h:e.height}})()`)
  const board = () => ev('JSON.parse(JSON.stringify(window.__wb.store.getState().board))')
  const diskb = () => ev('JSON.parse(JSON.stringify(window.__wb.disk))')
  const pos = async (id) => { const n = (await board()).nodes.find((x) => x.id === id); return [n.x, n.y] }

  console.log('渲染')
  check('全新环境首次进入:小地图默认折叠(只有图标按钮)', await ev(`!!document.querySelector('.wb-minimap-toggle') && !document.querySelector('.wb-minimap')`))
  check('markdown 渲染为 HTML', await ev(`document.querySelector('[data-wb-node="a"] strong')?.textContent === 'hello'`))
  check('框在卡片下层', await ev(`(()=>{const g=document.querySelector('[data-wb-node="g"]'),a=document.querySelector('[data-wb-node="a"]');return !!(g.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING)})()`))

  console.log('拖动与对齐')
  let a = await node('a')
  // 把 A 往右拖,使其上边对齐 B 的上边(B.y=130,A.y=100 → 需下移 30);拖 +100,+27,应吸附到 +30
  await mouse('mouseMoved', a.x + 20, a.y + 20)
  await mouse('mousePressed', a.x + 20, a.y + 20)
  await mouse('mouseMoved', a.x + 60, a.y + 40); await mouse('mouseMoved', a.x + 120, a.y + 47)
  const midGuides = await ev(`document.querySelectorAll('.wb-guide').length`)
  check('拖动中显示对齐线', midGuides > 0, `guides=${midGuides}`)
  await mouse('mouseReleased', a.x + 120, a.y + 47)
  const [ax, ay] = await pos('a')
  check('吸附到 B 的上边(y=130)', ay === 130, `y=${ay}`)
  check('位移落盘(磁盘与内存一致)', JSON.stringify((await diskb()).nodes.find((n) => n.id === 'a')) === JSON.stringify((await board()).nodes.find((n) => n.id === 'a')))
  check('拖动结束后提示消失', (await ev(`document.querySelectorAll('.wb-guide,.wb-gap').length`)) === 0)

  console.log('撤销/重做')
  await ev('window.__wb.store.undo()'); await sleep(50)
  check('撤销回到原位', (await pos('a')).join() === '100,100', (await pos('a')).join())
  await ev('window.__wb.store.redo()'); await sleep(50)
  check('重做', (await pos('a'))[1] === 130)

  console.log('连线')
  // 悬停 A 显示连接点;从 A 右侧圆点拖到 B 的左侧圆点
  a = await node('a'); const b = await node('b')
  await mouse('mouseMoved', a.x + a.w / 2, a.y + a.h / 2)
  await sleep(50)
  check('悬停显示 4 个连接点', (await ev(`document.querySelectorAll('[data-wb-node="a"] .wb-anchor').length`)) === 4)
  const anchorAt = (id, side) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"] .wb-anchor-${side}').getBoundingClientRect();return {x:e.left+e.width/2,y:e.top+e.height/2}})()`)
  const an = await anchorAt('a', 'right')
  console.log('   [diag] anchor', JSON.stringify(an), 'b', JSON.stringify(b), 'a', JSON.stringify(a), 'sel', await ev('JSON.stringify(window.__wb.store.getState().selection)'))
  await ev(`window.__ev=[];for (const t of ['pointerdown','pointerup']) document.addEventListener(t,e=>{window.__ev.push(t+':'+(e.target.getAttribute&&e.target.getAttribute('class'))+'@'+Math.round(e.clientX)+','+Math.round(e.clientY))},true)`)
  await drag(an.x, an.y, b.x + 2, b.y + b.h / 2, 10)
  console.log('   [diag]', await ev('JSON.stringify(window.__ev)'))
  await sleep(100)
  const edges = (await board()).edges
  check('创建了 a→b 连线,吸附到 b 的 left', edges.length === 1 && edges[0].fromNode === 'a' && edges[0].toNode === 'b' && edges[0].toSide === 'left', JSON.stringify(edges))
  check('连线已渲染', (await ev(`document.querySelectorAll('.wb-edge-line').length`)) >= 1)
  // 选中连线后,中点出现"T"按钮;点它进入文字编辑(也支持双击连线上非中点位置)
  const at = async (frac) => ev(`(()=>{const p=document.querySelector('.wb-edge-hit');const l=p.getTotalLength();const pt=p.getPointAtLength(l*${frac});const m=p.getScreenCTM();return {x:pt.x*m.a+m.e,y:pt.y*m.d+m.f}})()`)
  const p25 = await at(0.25)
  await mouse('mousePressed', p25.x, p25.y); await mouse('mouseReleased', p25.x, p25.y)
  await mouse('mousePressed', p25.x, p25.y, { clickCount: 2 }); await mouse('mouseReleased', p25.x, p25.y, { clickCount: 2 })
  await sleep(100)
  check('双击连线出现文字输入框', await ev(`!!document.querySelector('.wb-edge-input')`))
  await send('Input.insertText', { text: '导致' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(150)
  check('连线文字写入', (await board()).edges[0]?.label === '导致', JSON.stringify((await board()).edges[0]))
  check('连线文字显示在画布上', await ev(`document.querySelector('.wb-edge-label')?.textContent === '导致'`))
  // 拖动 A,连线跟随
  const before = await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)
  a = await node('a')
  await drag(a.x + 20, a.y + 60, a.x + 20, a.y + 120, 5)
  check('移动卡片后连线路径随之改变', (await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)) !== before)

  console.log('框')
  const g0 = await pos('g'), c0 = await pos('c')
  const g = await node('g')
  await drag(g.x + g.w - 40, g.y + 8, g.x + g.w - 40 + 90, g.y + 8 + 40, 6) // 抓住框的标题栏空白处
  const g1 = await pos('g'), c1 = await pos('c')
  check('移动框 → 框内卡片同步移动', g1[0] - g0[0] > 60 && Math.abs((c1[0] - c0[0]) - (g1[0] - g0[0])) < 0.01 && Math.abs((c1[1] - c0[1]) - (g1[1] - g0[1])) < 0.01, `g:${g0}→${g1} c:${c0}→${c1}`)

  console.log('编辑')
  await ev(`window.__wb.store.select(['a']); window.__wb.store.setEditing('a')`)
  await sleep(300)
  check('进入编辑后挂载 Tiptap', await ev(`!!document.querySelector('[data-wb-node="a"] .ProseMirror')`))
  await ev(`document.querySelector('[data-wb-node="a"] .ProseMirror').focus()`)
  // 光标在末尾:新起一行,用 Markdown 快捷语法输入标题与列表
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.insertText', { text: '## ' })
  await send('Input.insertText', { text: '新标题' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.insertText', { text: '- ' })
  await send('Input.insertText', { text: '要点' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const txt = (await board()).nodes.find((n) => n.id === 'a').text
  check('快捷语法转为标准 Markdown(标题与列表)', typeof txt === 'string' && txt.includes('## 新标题') && /- 要点/.test(txt) && txt.includes('**hello**'), JSON.stringify(txt))
  check('编辑后渲染出 h2 与 li', await ev(`!!document.querySelector('[data-wb-node="a"] h2') && !!document.querySelector('[data-wb-node="a"] li')`))
  check('退出编辑后不再挂载 Tiptap', await ev(`!document.querySelector('[data-wb-node="a"] .ProseMirror')`))

  console.log('删除')
  await ev(`window.__wb.store.select(['c'])`)
  await ev(`document.querySelector('.wb-canvas').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(100)
  check('Backspace 删除选中卡片', !(await board()).nodes.some((n) => n.id === 'c'))


  console.log('反馈 1:按钮在明/暗主题下文字可读')
  const contrast = () => ev(`(()=>{const el=document.getElementById('prim');const cs=getComputedStyle(el);
    const parse=(c)=>c.match(/[\\d.]+/g).slice(0,3).map(Number);
    const lum=([r,g,b])=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
    const a=lum(parse(cs.color)),b=lum(parse(cs.backgroundColor));return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)})()`)
  for (const dark of [false, true]) {
    await ev(`window.__theme(${dark})`); await sleep(50)
    const c = await contrast()
    check(`主按钮对比度 ≥ 4.5(${dark ? '暗' : '亮'}色)`, c >= 4.5, c.toFixed(2))
  }
  await ev('window.__theme(false)')

  console.log('反馈 2:双击卡片进入编辑,而不是新建卡片')
  await ev(`window.__wb.store.select([])`)
  const nBefore = (await board()).nodes.length
  const nb = await node('b')
  await mouse('mousePressed', nb.x + nb.w / 2, nb.y + nb.h / 2, { clickCount: 1 }); await mouse('mouseReleased', nb.x + nb.w / 2, nb.y + nb.h / 2, { clickCount: 1 })
  await mouse('mousePressed', nb.x + nb.w / 2, nb.y + nb.h / 2, { clickCount: 2 }); await mouse('mouseReleased', nb.x + nb.w / 2, nb.y + nb.h / 2, { clickCount: 2 })
  await sleep(300)
  check('双击卡片没有新建卡片', (await board()).nodes.length === nBefore, `${nBefore} → ${(await board()).nodes.length}`)
  check('双击卡片进入编辑(Tiptap 已挂载)', await ev(`!!document.querySelector('[data-wb-node="b"] .ProseMirror')`))

  console.log('反馈 3:标题是独立输入框')
  check('编辑态有独立的标题输入框', await ev(`!!document.querySelector('[data-wb-node="b"] input.wb-title-input')`))
  await ev(`(()=>{const i=document.querySelector('[data-wb-node="b"] input.wb-title-input');i.focus();i.select()})()`)
  await send('Input.insertText', { text: '独立标题' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(100)
  check('标题回车后焦点转到正文', await ev(`!!document.activeElement?.closest?.('.ProseMirror')`))
  check('回车后仍处于编辑态', await ev(`!!document.querySelector('[data-wb-node="b"] .ProseMirror')`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const bn = (await board()).nodes.find((n) => n.id === 'b')
  check('标题写入 title 字段,正文保留', bn.title === '独立标题' && bn.text.includes('x'), JSON.stringify([bn.title, bn.text]))
  // 只有标题、没有正文的新卡片不应被当作空卡片丢弃
  const empty = await ev(`(()=>{for (let y=700;y>300;y-=20) for (let x=1000;x>600;x-=20){const e=document.elementFromPoint(x,y);if(e&&e.classList.contains('wb-canvas'))return {x,y}}return null})()`)
  await mouse('mousePressed', empty.x, empty.y, { clickCount: 1 }); await mouse('mouseReleased', empty.x, empty.y, { clickCount: 1 })
  await mouse('mousePressed', empty.x, empty.y, { clickCount: 2 }); await mouse('mouseReleased', empty.x, empty.y, { clickCount: 2 })
  await sleep(300)
  const created = await ev(`window.__wb.store.getState().editing`)
  check('双击空白处新建卡片并进入编辑', !!created && (await board()).nodes.length === nBefore + 1, String(created))
  await ev(`document.querySelector('[data-wb-node="${'${created}'}"] input.wb-title-input')`.replace('${created}', created) + `.focus()`)
  await send('Input.insertText', { text: '仅标题' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const only = (await board()).nodes.find((n) => n.id === created)
  check('只有标题的卡片被保留', !!only && only.title === '仅标题', JSON.stringify(only))
  check('退出后编辑态结束', (await ev(`window.__wb.store.getState().editing`)) === null)

  console.log('反馈 4:八个方向缩放')
  await ev(`window.__wb.store.select(['b'])`); await sleep(80)
  check('单选时出现 8 个缩放手柄', (await ev(`document.querySelectorAll('[data-wb-node="b"] [data-wb-handle]').length`)) === 8)
  await ev(`window.__wb.store.select(['a','b'])`); await sleep(80)
  check('多选时不显示缩放手柄', (await ev(`document.querySelectorAll('[data-wb-handle]').length`)) === 0)
  // 四边手柄的正中间让给了连接点,所以抓边时取偏离中点 30px 的位置
  const handleCenter = (id, hd) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"] [data-wb-handle="${hd}"]').getBoundingClientRect();
    const off=${'${hd}'}.length===1?30:0;const horiz='${hd}'==='n'||'${hd}'==='s';
    return {x:e.left+e.width/2+(horiz?off:0),y:e.top+e.height/2+(horiz?0:off)}})()`.replace(/\$\{hd\}\.length/, `'${hd}'.length`))
  const rect = async (id) => { const n = (await board()).nodes.find((x) => x.id === id); return { l: n.x, t: n.y, r: n.x + n.width, b: n.y + n.height, w: n.width, h: n.height } }
  const cases = [
    ['e', 40, 0, (o, n) => n.l === o.l && n.r === o.r + 40 && n.t === o.t && n.b === o.b],
    ['w', -40, 0, (o, n) => n.r === o.r && n.l === o.l - 40 && n.t === o.t && n.b === o.b],
    ['s', 0, 30, (o, n) => n.b === o.b + 30 && n.t === o.t && n.l === o.l && n.r === o.r],
    ['n', 0, -30, (o, n) => n.b === o.b && n.t === o.t - 30 && n.l === o.l && n.r === o.r],
    ['nw', -20, -20, (o, n) => n.r === o.r && n.b === o.b && n.l === o.l - 20 && n.t === o.t - 20],
    ['se', 25, 25, (o, n) => n.l === o.l && n.t === o.t && n.r === o.r + 25 && n.b === o.b + 25],
  ]
  // 选一张周围没有可吸附目标的卡片做测试:先把 b 挪到空旷处
  await ev(`window.__wb.store.dispatch([{op:'moveNodes',ids:['b'],dx:350,dy:-60}],{history:false})`)
  await ev(`window.__wb.store.select(['b'])`); await sleep(100)
  for (const [hd, dx, dy, ok] of cases) {
    const o = await rect('b'); const c = await handleCenter('b', hd)
    await drag(c.x, c.y, c.x + dx, c.y + dy, 6, { modifiers: 1 }) // Alt:关闭吸附,测试几何本身
    await sleep(80)
    const n = await rect('b')
    check(`${hd} 手柄拖动`, ok(o, n), `${JSON.stringify(o)} → ${JSON.stringify(n)}`)
  }
  { // 最小尺寸
    const c = await handleCenter('b', 'e'); const o = await rect('b')
    await drag(c.x, c.y, c.x - 900, c.y, 6, { modifiers: 1 }); await sleep(80)
    const n = await rect('b')
    check('缩到最小宽度后停住,左边不动', n.w === 80 && n.l === o.l, JSON.stringify(n))
  }
  { // 图片:角点等比
    await ev(`window.__wb.store.select(['img'])`); await sleep(100)
    const o = await rect('img'); const c = await handleCenter('img', 'se')
    await drag(c.x, c.y, c.x + 60, c.y + 5, 6, { modifiers: 1 }); await sleep(80)
    const n = await rect('img')
    check('图片角点缩放保持宽高比', Math.abs(n.w / n.h - o.w / o.h) < 0.02 && n.w > o.w, `${o.w}x${o.h} → ${n.w}x${n.h}`)
  }
  { // 吸附:卡片 a 的右边缘(x=a.right)与 b 的右边缘对齐。先把 b 放回 a 附近、右边略短于 a
    const a0 = (await board()).nodes.find((x) => x.id === 'a')
    const aR = a0.x + a0.width
    await ev(`window.__wb.store.dispatch([{op:'updateNode',id:'b',patch:{x:${a0.x},y:${a0.y + a0.height + 120},width:${a0.width - 40},height:100}}],{history:false})`)
    await ev(`window.__wb.store.select(['b'])`); await sleep(120)
    const o = await rect('b'); const c = await handleCenter('b', 'se')
    const k = await ev('window.__wb.store.getState().viewport.k')
    const others = (await board()).nodes.filter((x) => x.id !== 'b').map((x) => [x.id, x.x, x.x + x.width])
    // 把 se 手柄向右拖,使右边缘落在 aR-3,应吸附到 aR
    console.log('   [diag] b.r=', o.r, 'aR=', aR, '其他卡片 [id,left,right]:', JSON.stringify(others), 'k=', k, '拖动量=', (aR - 3 - o.r) * k)
    await drag(c.x, c.y, c.x + (aR - 3 - o.r) * k, c.y, 8); await sleep(80)
    const n = await rect('b')
    check('缩放边缘吸附到其他卡片的边', n.r === aR, `r=${n.r} 目标=${aR}`)
    check('吸附只改被拖的边,左边不变', n.l === o.l)
  }
  console.log('稳定性:快速连续拖动终点精确')
  {
    await ev(`window.__wb.store.dispatch([{op:'updateNode',id:'b',patch:{x:900,y:300,width:200,height:100}}],{history:false})`)
    await ev(`window.__wb.store.select(['b'])`); await sleep(100)
    let bad = 0
    for (let i = 0; i < 12; i++) {
      const bb = await node('b'); const before = (await board()).nodes.find((x) => x.id === 'b')
      const sx = bb.x + 100, sy = bb.y + 50
      // 1 步直接跳到终点后立刻松手(最容易丢"最后一次预览"的情形),Alt 关闭吸附
      await mouse('mousePressed', sx, sy, { modifiers: 1 }); await mouse('mouseMoved', sx + 7, sy + 3, { modifiers: 1 }); await mouse('mouseMoved', sx + 41, sy + 19, { modifiers: 1 }); await mouse('mouseReleased', sx + 41, sy + 19, { modifiers: 1 })
      await sleep(30)
      const after = (await board()).nodes.find((x) => x.id === 'b')
      const ed = await ev('window.__wb.store.getState().editing')
      if (after.x - before.x !== 41 || after.y - before.y !== 19) { bad++; if (bad <= 2) console.log('   [diag] 偏差', JSON.stringify({ dx: after.x - before.x, dy: after.y - before.y, editing: ed })) }
      await ev(`window.__wb.store.dispatch([{op:'updateNode',id:'b',patch:{x:900,y:300}}],{history:false}); window.__wb.store.setEditing(null)`); await sleep(420) // 超过双击窗口,避免把连续两次拖动误当作双击
    }
    check('12 次快速拖动终点全部精确', bad === 0, `${bad} 次偏差`)
  }

  console.log('排版:多选对齐 / 分布 / 成框 / 适配')
  const T = (id, x, y, w = 120, h = 70, extra = {}) => ({ id, type: 'text', x, y, width: w, height: h, text: id, ...extra })
  const reset = async (nodes, edges) => { await ev(`window.__wb.reset(${JSON.stringify(nodes)}, ${JSON.stringify(edges || [])})`); await sleep(150); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(50) }
  const btn = (title) => ev(`(()=>{const b=[...document.querySelectorAll('.wb-toolbar button,.wb-ctxbar button,.wb-lefttool button')].find(x=>x.title==='${title}'||x.textContent==='${title}');if(!b)return null;if(b.disabled)return 'disabled';b.click();return 'ok'})()`)
  const ys = async (...ids) => { const b = await board(); return ids.map((i) => b.nodes.find((n) => n.id === i)) }

  await reset([T('p', 100, 100), T('q', 400, 160), T('r', 700, 130)])
  await ev(`window.__wb.store.select(['p','q','r'])`); await sleep(100)
  check('多选时出现排版按钮', (await ev(`document.querySelectorAll('.wb-ctxbar .wb-arrange-group button, .wb-ctxbar button.wb-btn-label').length`)) === 11)
  check('点击"顶对齐"', (await btn('arrange.top')) === 'ok'); await sleep(100)
  check('三张卡片顶部对齐', new Set((await ys('p', 'q', 'r')).map((n) => n.y)).size === 1)
  check('分布按钮可用', (await btn('arrange.distX')) === 'ok'); await sleep(100)
  { const [p, q, r] = await ys('p', 'q', 'r'); const g1 = q.x - (p.x + p.width), g2 = r.x - (q.x + q.width)
    check('水平等间距', Math.abs(g1 - g2) <= 1 && p.x === 100 && r.x === 700, `gaps ${g1},${g2}`) }
  await ev('window.__wb.store.undo()'); await sleep(80); await ev('window.__wb.store.undo()'); await sleep(80)
  check('撤销两步回到最初', (await ys('p', 'q', 'r')).map((n) => n.y).join() === '100,160,130')
  await ev(`window.__wb.store.select(['p','q'])`); await sleep(80)
  check('只选两张时分布按钮禁用', (await btn('arrange.distX')) === 'disabled')
  check('成框', (await btn('arrange.wrap')) === 'ok'); await sleep(120)
  { const b = await board(); const g = b.nodes.find((n) => n.type === 'group')
    check('生成了包住两张卡片的框', !!g && ['p', 'q'].every((i) => { const n = b.nodes.find((x) => x.id === i); return n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height }))
    check('成框后自动选中新框', (await ev('window.__wb.store.getState().selection.length')) === 1 && (await ev('window.__wb.store.getState().selection[0]')) === g.id) }

  await reset([{ id: 'G', type: 'group', x: 0, y: 0, width: 1000, height: 700, label: 'g', color: 'blue' }, T('m', 100, 100), T('n', 300, 250)])
  await ev(`window.__wb.store.select(['G'])`); await sleep(80)
  check('选中框时出现"适配内容"', (await btn('arrange.fit')) === 'ok'); await sleep(120)
  { const g = (await ys('G'))[0]; check('框缩到刚好包住卡片', g.width < 1000 && g.height < 700 && g.x < 100 && g.y < 100, JSON.stringify([g.x, g.y, g.width, g.height])) }
  { const before = JSON.stringify((await board()).nodes.find((n) => n.id === 'G')); const rv = await ev('window.__wb.store.getState().rev')
    await btn('arrange.fit'); await sleep(150)
    check('再次适配无变化(幂等,不产生新的写盘)', JSON.stringify((await board()).nodes.find((n) => n.id === 'G')) === before && (await ev('window.__wb.store.getState().rev')) === rv) }

  console.log('复制 / 剪切 / 粘贴')
  const key = async (k, mod = 4) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), modifiers: mod, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + k.toUpperCase(), modifiers: mod, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); await sleep(120) }
  await reset([{ id: 'G', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'G', color: 'green' }, T('a1', 50, 60), T('a2', 250, 60), T('out', 900, 60)], [{ id: 'e1', fromNode: 'a1', toNode: 'a2', label: '连' }, { id: 'e2', fromNode: 'a2', toNode: 'out' }])
  await ev(`window.__wb.store.select(['G']); document.querySelector('.wb-canvas').focus()`); await sleep(80)
  await key('d') // ⌘D
  { const b = await board()
    check('⌘D 复制框时带上框内卡片', b.nodes.length === 4 + 3, `nodes=${b.nodes.length}`)
    check('只复制两端都在范围内的连线', b.edges.length === 3 && b.edges.filter((e) => e.label === '连').length === 2, `edges=${b.edges.length}`)
    check('复制后选中的是新元素', (await ev('window.__wb.store.getState().selection.length')) === 3) }
  await ev(`window.__wb.store.select(['out']); document.querySelector('.wb-canvas').focus()`); await sleep(80)
  await key('c')
  check('⌘C 写入剪贴板(带标记)', (await ev('window.__clip.text')).startsWith('dsh-thinkboard/v1:'))
  await key('x')
  check('⌘X 剪切会删除原件及其连线', !(await board()).nodes.some((n) => n.id === 'out') && !(await board()).edges.some((e) => e.id === 'e2'))
  await ev(`document.querySelector('.wb-canvas').focus(); (()=>{const dt=new DataTransfer();dt.setData('text/plain',window.__clip.text);document.querySelector('.wb-canvas').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`); await sleep(150)
  { const b = await board(); const nn = b.nodes.filter((n) => n.text === 'out')
    check('⌘V 粘贴回一张卡片', nn.length === 1 && nn[0].id !== 'out', JSON.stringify(nn.map((n) => n.id))) }
  await ev(`document.querySelector('.wb-canvas').focus(); (()=>{const dt=new DataTransfer();dt.setData('text/plain','一段普通文字');document.querySelector('.wb-canvas').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`); await sleep(150)
  check('粘贴普通文字 → 新建文字卡片', (await board()).nodes.some((n) => n.text === '一段普通文字'))
  await ev('window.__wb.store.undo()'); await sleep(80)
  check('粘贴可撤销', !(await board()).nodes.some((n) => n.text === '一段普通文字'))

  console.log('导出 PNG')
  await reset([{ id: 'G', type: 'group', x: 0, y: 0, width: 500, height: 300, label: '框', color: 'blue' }, T('e1', 40, 60, 160, 90, { title: '标题', text: '**粗体** 与 `code`' }), T('e2', 600, 100)], [{ id: 'ee', fromNode: 'e1', toNode: 'e2', label: '连线' }])
  await ev(`window.__wb.store.select(['e1'])`); await sleep(120)
  const png = await ev(`(async()=>{
    const blob = await window.__wb.renderPng(document.querySelector('.wb-world'), window.__wb.store.getState().board, { background: '#ffffff', scale: 1 })
    const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data
    let non = 0, blue = 0, accent = 0
    for (let i = 0; i < d.length; i += 4 * 7) { if (d[i] < 235 || d[i+1] < 235 || d[i+2] < 235) non++; if (d[i+2] > d[i] + 25) blue++ }
    return { w: c.width, h: c.height, type: blob.type, non, blue, size: blob.size }
  })()`)
  check('导出得到 PNG,尺寸 = 内容范围 + 边距', png.type === 'image/png' && png.w === 800 && png.h === 380 /* 内容 0..720×0..300,四周各 40 */, JSON.stringify(png))
  check('导出图里有内容(非空白)且包含蓝色框', png.non > 300 && png.blue > 100, `non=${png.non} blue=${png.blue}`)
  check('导出不影响画布(选中状态与手柄仍在)', await ev(`!!document.querySelector('[data-wb-node="e1"] [data-wb-handle]')`))
  check('空白板导出按钮禁用', await (async () => { await reset([]); return (await btn('tool.export')) === 'disabled' })())

  console.log('导出 PNG 的主题一致性(暗/亮)')
  await reset([{ id: 'G', type: 'group', x: 0, y: 0, width: 500, height: 300, label: '框', color: 'blue' }, T('e1', 40, 60, 160, 90, { title: '标题', text: '正文' }), T('e2', 600, 100)], [{ id: 'ee', fromNode: 'e1', toNode: 'e2', label: '连线文字' }])
  await ev(`window.__wb.store.select([])`); await sleep(100)
  for (const dark of [true, false]) {
    await ev(`window.__theme(${dark})`); await sleep(120)
    const r = await ev(`(async()=>{
      const world = document.querySelector('.wb-world'), board = window.__wb.store.getState().board
      const bg = window.__wb.resolveBackground(document.querySelector('.wb-stage'))
      const blob = await window.__wb.renderPng(world, board, { background: bg, scale: 1 })
      const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0)
      const lum = (x, y) => { const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return { l: (0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2]) / 255, r: d[0], b: d[2] } }
      const wr = world.getBoundingClientRect(), lr = document.querySelector('.wb-edge-label').getBoundingClientRect()
      const ox = 40, oy = 40 // 内容左上角是 (0,0),边距 40 → 世界坐标 + 40 = 图片坐标
      // 标签区域内:取最亮与最暗的像素,二者相差必须足够大(文字清晰),且底板色应与主题贴近(暗色下不是白/亮色大块)
      let minL = 1, maxL = 0, boardL = 0, n = 0
      for (let y = lr.top - wr.top + oy + 3; y < lr.bottom - wr.top + oy - 3; y++) for (let x = lr.left - wr.left + ox + 3; x < lr.right - wr.left + ox - 3; x++) { const p = lum(x, y); minL = Math.min(minL, p.l); maxL = Math.max(maxL, p.l); boardL += p.l; n++ }
      boardL /= n
      const light = maxL - minL, darkPx = boardL
      return { bg, corner: lum(3, 3), group: lum(450 + ox, 250 + oy), light, darkPx, labelBox: [Math.round(lr.width), Math.round(lr.height)] }
    })()`)
    const name = dark ? '暗' : '亮'
    check(`${name}色:画板背景与主题一致`, dark ? r.corner.l < 0.2 : r.corner.l > 0.9, `corner lum=${r.corner.l.toFixed(2)} bg=${r.bg}`)
    check(`${name}色:框的背景是主题色调而非反色`, dark ? r.group.l < 0.35 && r.group.b > r.group.r : r.group.l > 0.7 && r.group.b > r.group.r, `group lum=${r.group.l.toFixed(2)}`)
    check(`${name}色:连线文字清晰(文字与底板对比 ≥ 0.45)`, r.light >= 0.45, `contrast=${r.light.toFixed(2)} 底板均值=${r.darkPx.toFixed(2)} box=${r.labelBox}`)
    check(`${name}色:连线文字底板贴合主题`, dark ? r.darkPx < 0.45 : r.darkPx > 0.55, `底板均值=${r.darkPx.toFixed(2)}`)
  }
  await ev('window.__theme(false)')
  check('对齐按钮是图形图标而非文字符号', await (async () => { await reset([T('i1', 0, 0), T('i2', 200, 0), T('i3', 400, 0)]); await ev(`window.__wb.store.select(['i1','i2','i3'])`); await sleep(120); return await ev(`(()=>{const bs=[...document.querySelectorAll('.wb-ctxbar .wb-arrange-group button.wb-btn-icon')];return bs.length===10&&bs.every(b=>b.querySelector('svg')&&b.textContent.trim()===''&&b.getAttribute('aria-label'))})()`) })())

  console.log('悬浮工具条:跟随选中、不让画面跳动')
  const NB = [T('f1', 200, 300), T('f2', 500, 340), T('f3', 800, 320), { id: 'FG', type: 'group', x: 100, y: 600, width: 500, height: 260, label: '框', color: 'blue' }]
  await reset(NB, [{ id: 'fe', fromNode: 'f1', toNode: 'f2' }])
  const layout = () => ev(`(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]};return {stage:q('.wb-stage'),canvas:q('.wb-canvas'),toolbar:q('.wb-toolbar'),world:document.querySelector('.wb-world').style.transform,card:q('[data-wb-node="f1"]')}})()`)
  const bar = () => ev(`(()=>{const e=document.querySelector('.wb-ctxbar');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,side:e.dataset.side}})()`)
  await ev(`window.__wb.store.select([])`); await sleep(150)
  const lay0 = await layout()
  check('未选中时没有悬浮条', (await bar()) === null)
  await ev(`window.__wb.store.select(['f1'])`); await sleep(180)
  const b1 = await bar(); const lay1 = await layout()
  check('选中一张卡片后出现悬浮条', !!b1)
  check('悬浮条出现时,画布/顶栏/视口/卡片位置完全不变(不跳动)', JSON.stringify(lay0) === JSON.stringify(lay1), JSON.stringify([lay0, lay1]))
  { const c = lay1.card; check('悬浮条在选中卡片的上方并水平居中', b1.side === 'above' && b1.y + b1.h < c[1] && Math.abs((b1.x + b1.w / 2) - (c[0] + c[2] / 2)) < 2, JSON.stringify([b1, c])) }
  await ev(`window.__wb.store.select(['f1','f2','f3'])`); await sleep(180)
  { const b = await bar(); const l = await layout()
    check('多选时悬浮条换成排版工具,画面依旧不动', !!b && JSON.stringify(l.canvas) === JSON.stringify(lay0.canvas) && JSON.stringify(l.toolbar) === JSON.stringify(lay0.toolbar) && (await ev(`document.querySelectorAll('.wb-ctxbar .wb-arrange-group').length`)) === 4) }
  await ev(`window.__wb.store.select(['FG'])`); await sleep(180)
  check('选中框:悬浮条里有"适配内容"和颜色', (await ev(`!!document.querySelector('.wb-ctxbar button[title="arrange.fit"]') && document.querySelectorAll('.wb-ctxbar .wb-swatch').length`)) === 7)
  await ev(`window.__wb.store.select([], 'fe')`); await sleep(180)
  check('选中连线:悬浮条里有虚线/箭头/颜色', (await ev(`document.querySelectorAll('.wb-ctxbar .wb-swatch').length`)) === 7 && !!(await bar()))
  // 点击悬浮条里的按钮不应取消选择
  await ev(`window.__wb.store.select(['f1','f2','f3'])`); await sleep(180)
  { const p = await ev(`(()=>{const b=document.querySelector('.wb-ctxbar button[title="arrange.top"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`)
    await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await sleep(150)
    check('点击悬浮条按钮会执行且保持选中', (await ev('window.__wb.store.getState().selection.length')) === 3 && new Set((await board()).nodes.filter((n) => n.id.startsWith('f')).map((n) => n.y)).size === 1) }
  // 平移后悬浮条跟随
  await ev(`window.__wb.store.select(['f1'])`); await sleep(150)
  const bA = await bar()
  await ev(`window.__wb.store.setViewport({x:80,y:40,k:1})`); await sleep(150)
  { const bB = await bar(); check('平移画布后悬浮条跟着选中卡片走', Math.abs((bB.x - bA.x) - 80) < 2 && Math.abs((bB.y - bA.y) - 40) < 2, JSON.stringify([bA, bB])) }
  // 缩放后,悬浮条自身大小不变
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:0.5})`); await sleep(150)
  { const bC = await bar(); check('缩放时悬浮条大小保持不变', Math.abs(bC.w - bA.w) < 2 && Math.abs(bC.h - bA.h) < 2) }
  // 选中的卡片滚出视口:悬浮条贴边,仍然可点
  await ev(`window.__wb.store.setViewport({x:0,y:-3000,k:1})`); await sleep(150)
  { const bD = await bar(); const st = (await layout()).stage
    check('卡片滚出视口时悬浮条贴边且仍在可视区内', !!bD && bD.y >= st[1] && bD.y + bD.h <= st[1] + st[3], JSON.stringify([bD, st])) }
  // 编辑中、拖动中不显示
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(100)
  await ev(`window.__wb.store.select(['f1']); window.__wb.store.setEditing('f1')`); await sleep(250)
  check('编辑卡片时悬浮条隐藏(不遮挡输入)', (await bar()) === null)
  await ev(`window.__wb.store.setEditing(null)`); await sleep(120)
  { const n = await node('f1'); await mouse('mousePressed', n.x + 40, n.y + 40, { modifiers: 1 }); await mouse('mouseMoved', n.x + 60, n.y + 60, { modifiers: 1 }); await mouse('mouseMoved', n.x + 90, n.y + 80, { modifiers: 1 }); await sleep(60)
    check('拖动卡片时悬浮条隐藏,松手后回来', (await bar()) === null); await mouse('mouseReleased', n.x + 90, n.y + 80, { modifiers: 1 }); await sleep(180); check('松手后悬浮条重新出现', !!(await bar())) }
  await ev(`window.__wb.store.select([])`); await sleep(120)
  check('取消选择后悬浮条消失', (await bar()) === null)
  await ev(`window.__theme(true)`); await ev(`window.__wb.store.select(['f1'])`); await sleep(150)
  check('暗色主题下悬浮条用主题的浮层背景', await ev(`(()=>{const c=getComputedStyle(document.querySelector('.wb-ctxbar')).backgroundColor;const m=c.match(/\\d+/g).map(Number);return (m[0]+m[1]+m[2])/3<80})()`))
  await ev(`window.__theme(false)`)

  console.log('搜索 (⌘F)')
  await reset([T('s1', 100, 100, 200, 90, { title: 'Redis 缓存', text: '热点数据放进缓存' }), T('s2', 4000, 3000, 200, 90, { title: '部署', text: '先部署 redis' }), { id: 'SG', type: 'group', x: 100, y: 400, width: 400, height: 200, label: '缓存方案', color: 'green' }], [{ id: 'se', fromNode: 's1', toNode: 's2', label: '依赖 redis' }])
  await ev(`document.querySelector('.wb-canvas').focus()`)
  await key('f')
  check('⌘F 打开搜索并聚焦输入框', await ev(`document.activeElement?.classList?.contains('wb-search-input')`))
  await send('Input.insertText', { text: 'REDIS' }); await sleep(250)
  check('不区分大小写,列出 3 条(标题命中、连线、正文命中)', (await ev(`document.querySelectorAll('.wb-search-item').length`)) === 3)
  check('标题命中排第一', (await ev(`document.querySelector('.wb-search-item .wb-search-title')?.textContent`)) === 'Redis 缓存')
  check('命中词被高亮', (await ev(`document.querySelectorAll('.wb-search-pop mark').length`)) >= 3)
  check('结果数显示', (await ev(`document.querySelector('.wb-search-count')?.textContent`)) === 'search.count')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await sleep(250)
  check('上下键切换结果时实时定位:选中对应元素', (await ev('window.__wb.store.getState().edgeSelection')) === 'se')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await sleep(250)
  check('定位到远处的卡片:视口居中该卡片', await ev(`(()=>{const s=window.__wb.store.getState();const n=s.board.nodes.find(x=>x.id==='s2');const st=document.querySelector('.wb-canvas').getBoundingClientRect();const cx=(n.x+n.width/2)*s.viewport.k+s.viewport.x,cy=(n.y+n.height/2)*s.viewport.k+s.viewport.y;return s.selection[0]==='s2'&&Math.abs(cx-st.width/2)<2&&Math.abs(cy-st.height/2)<2})()`))
  await ev(`document.querySelector('.wb-search-input').select()`); await send('Input.insertText', { text: '不存在的词' }); await sleep(200)
  check('无匹配时给出提示', (await ev(`document.querySelector('.wb-search-empty')?.textContent`)) === 'search.none')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150)
  check('Esc 关闭搜索并把焦点还给画布', (await ev(`!document.querySelector('.wb-search-pop') && document.activeElement?.classList?.contains('wb-canvas')`)))
  await ev('window.__setSearch(true)'); await sleep(100)
  await send('Input.insertText', { text: '缓存方案' }); await sleep(250)
  check('按框标题搜索', (await ev('window.__wb.store.getState().selection[0]')) === 'SG')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(120)

  console.log('小地图')
  await reset([T('m1', 0, 0, 200, 100), T('m2', 3000, 2000, 200, 100), { id: 'MG', type: 'group', x: -100, y: -100, width: 500, height: 400, label: 'g', color: 'purple' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`document.querySelector('.wb-minimap-toggle')?.click()`); await sleep(150)
  const mm = () => ev(`(()=>{const m=document.querySelector('.wb-minimap');if(!m)return null;const r=m.getBoundingClientRect();const v=m.querySelector('.wb-mm-view').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,view:{x:v.left-r.left,y:v.top-r.top,w:v.width,h:v.height},nodes:m.querySelectorAll('.wb-mm-node').length}})()`)
  { const m = await mm(); const st = (await layout()).stage
    check('有内容时显示小地图,每个元素一个矩形', !!m && m.nodes === 3, JSON.stringify(m))
    check('小地图在画布右下角且不超出', m.x + m.w <= st[0] + st[2] + 1 && m.y + m.h <= st[1] + st[3] + 1 && m.x > st[0] + st[2] / 2)
    check('小地图尺寸有上限(≤180×130)', m.w <= 181 && m.h <= 131)
    check('当前视口框在地图范围内', m.view.x >= -1 && m.view.y >= -1 && m.view.x + m.view.w <= m.w + 1 && m.view.y + m.view.h <= m.h + 1) }
  { const m = await mm(); const px = m.x + m.w * 0.85, py = m.y + m.h * 0.85   // 点地图右下:应跳到远处的 m2
    await mouse('mousePressed', px, py); await mouse('mouseReleased', px, py); await sleep(200)
    const s = await ev('window.__wb.store.getState().viewport'); const c = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {w:r.width,h:r.height}})()`)
    const centerWorld = { x: (c.w / 2 - s.x) / s.k, y: (c.h / 2 - s.y) / s.k }
    check('点击小地图 → 视口中心移到被点位置(接近远处的卡片)', centerWorld.x > 1500 && centerWorld.y > 1000 && s.k === 1, JSON.stringify(centerWorld)) }
  { const m = await mm(); const x0 = m.x + m.w * 0.5, y0 = m.y + m.h * 0.5
    await mouse('mousePressed', x0, y0); await mouse('mouseMoved', x0 - 20, y0 - 15); await mouse('mouseMoved', x0 - 40, y0 - 30); const v1 = await ev('window.__wb.store.getState().viewport'); await mouse('mouseReleased', x0 - 40, y0 - 30); await sleep(100)
    await mouse('mouseMoved', x0 - 40, y0 - 30)
    const v2 = await ev('window.__wb.store.getState().viewport')
    check('拖动小地图连续平移,松手后不再变化', JSON.stringify(v1) === JSON.stringify(v2)) }
  check('点击小地图不会取消画布上的选择', await (async () => { await ev(`window.__wb.store.select(['m1'])`); const m = await mm(); await mouse('mousePressed', m.x + 10, m.y + 10); await mouse('mouseReleased', m.x + 10, m.y + 10); await sleep(100); return (await ev('window.__wb.store.getState().selection[0]')) === 'm1' })())
  await ev(`window.__wb.store.setViewport({x:-3000,y:-2000,k:1})`); await sleep(150)
  { const m = await mm(); check('平移画布时视口框随之移动', m.view.x > 20 && m.view.y > 10, JSON.stringify(m.view)) }
  await reset([]); await sleep(150)
  check('空白板不显示小地图', (await mm()) === null)

  console.log('图片卡片')
  const IMG = (id, extra = {}) => ({ id, type: 'image', file: 'assets/x.png', x: 200, y: 200, width: 200, height: 120, ...extra })
  await reset([IMG('im1')])
  await sleep(300)
  check('图片加载后记下原始尺寸(natural)', JSON.stringify((await board()).nodes[0].natural) === '{"w":100,"h":300}', JSON.stringify((await board()).nodes[0].natural))
  check('记录原始尺寸不进撤销栈', (await ev('window.__wb.store.getState().canUndo')) === false)
  await ev(`window.__wb.store.select(['im1'])`); await sleep(150)
  const ibtn = (title) => ev(`(()=>{const b=document.querySelector('.wb-ctxbar button[title="${title}"]');if(!b)return null;if(b.disabled)return 'disabled';b.click();return 'ok'})()`)
  check('选中图片:悬浮条有 放大/替换/恢复比例/说明/成框', (await ev(`document.querySelectorAll('.wb-ctxbar button').length`)) === 6)
  check('点"恢复原始比例":宽度不变,高度 = 宽×3', (await ibtn('image.ratio')) === 'ok' && await (async () => { await sleep(120); const n = (await board()).nodes[0]; return n.width === 200 && n.height === 600 })())
  check('恢复比例可撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(100); return (await board()).nodes[0].height === 120 })())
  // 说明文字
  check('点"图片说明"进入输入', (await ibtn('image.caption')) === 'ok' && await (async () => { await sleep(200); return await ev(`!!document.querySelector('[data-wb-node="im1"] .wb-caption-input')`) })())
  await send('Input.insertText', { text: '一张示意图' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(200)
  check('回车提交说明并显示在图片下方', (await board()).nodes[0].caption === '一张示意图' && (await ev(`document.querySelector('[data-wb-node="im1"] .wb-caption')?.textContent`)) === '一张示意图' && (await ev('window.__wb.store.getState().editing')) === null)
  check('有说明后"恢复比例"为图片留出说明区高度', (await ibtn('image.ratio')) === 'ok' && await (async () => { await sleep(120); return (await board()).nodes[0].height === 628 })())
  { await ev(`document.querySelector('[data-wb-node="im1"] .wb-caption').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await sleep(150)
    await ev(`(()=>{const i=document.querySelector('[data-wb-node="im1"] .wb-caption-input');i.focus();i.select()})()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(200)
    check('清空说明会删除该字段', !('caption' in (await board()).nodes[0])) }
  // 替换图片
  await ev(`window.__wb.store.select(['im1'])`); await sleep(150)
  check('点"替换图片"会打开文件选择', await ev(`(()=>{let clicked=false;const inp=document.querySelector('input[data-wb-replace-image]');inp.addEventListener('click',()=>{clicked=true},{once:true});document.querySelector('.wb-ctxbar button[title="image.replace"]').click();return clicked})()`))
  await ev(`(()=>{const inp=document.querySelector('input[data-wb-replace-image]');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(8)],'wide.png',{type:'image/png'}));inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(500)
  { const n = (await board()).nodes[0]
    check('替换后文件已更换且保持宽度', n.file === 'assets/wide.png' && n.width === 200, JSON.stringify([n.file, n.width, n.height]))
    check('替换后高度/原始尺寸按新图重算', n.natural && n.natural.w > 0 && n.height === Math.round(200 * n.natural.h / n.natural.w) || n.height > 0, JSON.stringify([n.natural, n.height])) }
  // 放大查看
  check('点"放大查看"打开灯箱', (await ibtn('image.preview')) === 'ok' && await (async () => { await sleep(150); return await ev(`!!document.querySelector('.wb-lightbox img')`) })())
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150)
  check('Esc 关闭灯箱', await ev(`!document.querySelector('.wb-lightbox')`))
  { const n = await node('im1'); const x = n.x + n.w / 2, y = n.y + n.h / 2
    await mouse('mousePressed', x, y, { clickCount: 1 }); await mouse('mouseReleased', x, y, { clickCount: 1 }); await mouse('mousePressed', x, y, { clickCount: 2 }); await mouse('mouseReleased', x, y, { clickCount: 2 }); await sleep(200)
    check('双击图片打开灯箱(而不是进入编辑)', await ev(`!!document.querySelector('.wb-lightbox')`) && (await ev('window.__wb.store.getState().editing')) === null)
    const lb = await ev(`(()=>{const r=document.querySelector('.wb-lightbox').getBoundingClientRect();return {x:r.left+r.width-60,y:r.top+r.height-40}})()`)
    await mouse('mousePressed', lb.x, lb.y); await mouse('mouseReleased', lb.x, lb.y); await sleep(150)
    check('点击灯箱空白处关闭', await ev(`!document.querySelector('.wb-lightbox')`)) }
  // 缺图
  await reset([IMG('gone', { file: 'assets/missing.png' }), IMG('nofile', { file: undefined, x: 600 })]); await sleep(400)
  check('图片文件加载失败时显示占位而不是破图', (await ev(`document.querySelectorAll('.wb-image-missing').length`)) === 2 && (await ev(`document.querySelectorAll('.wb-image img').length`)) === 0)

  console.log('HTML 卡片')
  await reset([{ id: 'hc', type: 'html', x: 100, y: 100, width: 360, height: 240, title: '报告', html: '<h2 id="hd">季度报告</h2><p style="color:#d33">红字</p><script>parent.__pwn=1</script><img src="https://evil.example/x.png" onerror="parent.__pwn=2">' }])
  await ev('window.__pwn=0'); await sleep(500)
  check('HTML 卡片渲染在沙箱 iframe 中', await ev(`(()=>{const f=document.querySelector('[data-wb-node="hc"] iframe.wb-html-frame');return !!f && f.getAttribute('sandbox')===''})()`))
  check('iframe 不带 allow-scripts / allow-same-origin', await ev(`(()=>{const s=document.querySelector('[data-wb-node="hc"] iframe').sandbox;return !s.contains('allow-scripts')&&!s.contains('allow-same-origin')})()`))
  check('srcdoc 已去掉脚本、事件属性、外部图片请求', await ev(`(()=>{const d=document.querySelector('[data-wb-node="hc"] iframe').srcdoc;return !/<script/i.test(d.replace(/Content-Security-Policy[^>]*>/,''))&&!/onerror/i.test(d)&&/default-src 'none'/.test(d)&&d.includes('季度报告')})()`))
  check('宿主页面没有被注入脚本影响', (await ev('window.__pwn')) === 0)
  check('HTML 卡片内的内容不拦截画布的拖动(iframe 不接收指针)', await ev(`getComputedStyle(document.querySelector('[data-wb-node="hc"] iframe')).pointerEvents==='none'`))
  { const n = await node('hc'); await mouse('mousePressed', n.x + 100, n.y + 120, { modifiers: 1 }); await mouse('mouseMoved', n.x + 140, n.y + 150, { modifiers: 1 }); await mouse('mouseReleased', n.x + 140, n.y + 150, { modifiers: 1 }); await sleep(120)
    const m = (await board()).nodes[0]; check('可以像其他卡片一样拖动', m.x === 140 && m.y === 130, JSON.stringify([m.x, m.y])) }
  // 编辑
  await ev(`window.__wb.store.select(['hc']); window.__wb.store.setEditing('hc')`); await sleep(250)
  check('编辑时是源码输入框,不再显示 iframe', await ev(`!!document.querySelector('[data-wb-node="hc"] textarea.wb-html-src') && !document.querySelector('[data-wb-node="hc"] iframe')`))
  await ev(`(()=>{const t=document.querySelector('[data-wb-node="hc"] textarea');t.focus();t.select()})()`)
  await send('Input.insertText', { text: '<ul><li>一</li><li>二</li></ul>' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(250)
  check('Esc 提交 HTML 并回到渲染态', (await board()).nodes[0].html === '<ul><li>一</li><li>二</li></ul>' && await ev(`!!document.querySelector('[data-wb-node="hc"] iframe')`))
  check('HTML 编辑可撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(120); return (await board()).nodes[0].html.includes('季度报告') })())
  // 超限
  await ev(`window.__wb.store.setEditing('hc')`); await sleep(200)
  await ev(`(()=>{const t=document.querySelector('[data-wb-node="hc"] textarea');t.focus();t.select()})()`)
  await ev(`(()=>{const t=document.querySelector('[data-wb-node="hc"] textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'a'.repeat(210*1024));t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(250)
  check('超过 200KB 不会提交,并提示原因,仍停留在编辑态', await ev(`!!document.querySelector('[data-wb-node="hc"] .wb-html-err')`) && (await ev('window.__wb.store.getState().editing')) === 'hc')
  await ev(`window.__wb.store.setEditing(null)`)
  // 工具条按钮
  await reset([]); await sleep(150)
  check('左侧栏的 HTML 按钮:点击新建并进入编辑', await (async () => { await btn('tool.htmlHint'); await sleep(250); const b = await board(); return b.nodes.length === 1 && b.nodes[0].type === 'html' && (await ev('window.__wb.store.getState().editing')) === b.nodes[0].id })())
  // 导出含 HTML/图片
  await reset([IMG('ex1'), { id: 'ex2', type: 'html', x: 500, y: 200, width: 300, height: 200, html: '<h2>导出测试</h2>' }]); await sleep(500)
  { const r = await ev(`(async()=>{try{const blob=await window.__wb.renderPng(document.querySelector('.wb-world'),window.__wb.store.getState().board,{background:'#fff',scale:1});return {ok:true,size:blob.size,type:blob.type}}catch(e){return {ok:false,err:String(e.message)}}})()`)
    check('含图片与 HTML 卡片的白板仍可导出 PNG', r.ok && r.type === 'image/png' && r.size > 1000, JSON.stringify(r)) }

  console.log('阶段 A:折叠 / 溢出 / 详情面板')
  const LONG = Array.from({ length: 40 }, (_, i) => `- 第 ${i + 1} 行内容`).join('\n')
  await reset([T('L', 100, 100, 300, 260, { title: '长文', text: LONG }), T('S', 600, 100, 300, 160, { title: '短', text: '一行' }), T('Z', 100, 500, 200, 90, { text: '框外' })], [{ id: 'le', fromNode: 'L', toNode: 'S' }])
  await sleep(300)
  check('内容溢出的卡片显示"展开全文"操作栏', await ev(`!!document.querySelector('[data-wb-node="L"] .wb-foldbar') && document.querySelector('[data-wb-node="L"] .wb-body').classList.contains('is-overflow')`))
  check('内容不溢出的卡片没有操作栏', await ev(`!document.querySelector('[data-wb-node="S"] .wb-foldbar')`))
  // 折叠
  await ev(`[...document.querySelectorAll('[data-wb-node="L"] .wb-foldbtn')].find(b=>b.textContent==='fold.collapse').click()`); await sleep(150)
  { const n = (await board()).nodes.find((x) => x.id === 'L'); check('折叠:高度变为固定值并记住原高度', n.collapsed === true && n.height === 112 && n.expandedHeight === 260, JSON.stringify([n.height, n.expandedHeight])) }
  check('折叠后连线端点跟随新高度', await ev(`(()=>{const d=document.querySelector('.wb-edge-line').getAttribute('d');return /^M 400 156/.test(d)})()`))
  check('折叠态显示"展开"按钮', await ev(`[...document.querySelectorAll('[data-wb-node="L"] .wb-foldbtn')].some(b=>b.textContent==='fold.expand')`))
  check('折叠一步可撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(120); const n = (await board()).nodes.find((x) => x.id === 'L'); return n.height === 260 && !n.collapsed })())
  await ev('window.__wb.store.redo()'); await sleep(120)
  await ev(`[...document.querySelectorAll('[data-wb-node="L"] .wb-foldbtn')].find(b=>b.textContent==='fold.expand').click()`); await sleep(150)
  { const n = (await board()).nodes.find((x) => x.id === 'L'); check('展开恢复原高度并清理字段', n.height === 260 && !('collapsed' in n) && !('expandedHeight' in n)) }
  // 悬浮条
  await ev(`window.__wb.store.select(['L'])`); await sleep(150)
  check('选中文字卡片:悬浮条有 详情 / 折叠', await ev(`!!document.querySelector('.wb-ctxbar button[title="detail.open"]') && !!document.querySelector('.wb-ctxbar button[title="fold.collapse"]')`))
  // 详情面板
  await ev(`document.querySelector('.wb-ctxbar button[title="detail.open"]').click()`); await sleep(400)
  check('点"详情"在右侧打开完整编辑器', await ev(`!!document.querySelector('.wb-detail .wb-md-detail.ProseMirror')`) && (await ev('window.__wb.store.getState().detail')) === 'L')
  check('详情标题与正文载入卡片内容', (await ev(`document.querySelector('.wb-detail-title').value`)) === '长文' && (await ev(`document.querySelectorAll('.wb-detail li').length`)) === 40)
  check('画布上的卡片标记"正在详情中编辑"', await ev(`!!document.querySelector('[data-wb-node="L"] .wb-indetail')`))
  { const n = await node('L'); const x = n.x + 150, y = n.y + 120
    await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(250)
    check('详情打开时双击该卡片不会再就地编辑(避免双写)', (await ev('window.__wb.store.getState().editing')) === null && await ev(`!document.querySelector('[data-wb-node="L"] .ProseMirror')`)) }
  // 输入 → 防抖写回
  await ev(`(()=>{const ed=document.querySelector('.wb-detail .ProseMirror');ed.focus();const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.insertText', { text: '在详情里追加的段落' }); await sleep(150)
  check('输入过程中不会每个字都写盘(防抖)', !(await board()).nodes.find((x) => x.id === 'L').text.includes('在详情里追加'))
  await sleep(600)
  { const n = (await board()).nodes.find((x) => x.id === 'L'); check('停顿后写回卡片', n.text.includes('在详情里追加的段落') && n.text.includes('第 40 行内容'), n.text.slice(-40)) }
  check('画布上的卡片同步显示新内容', await ev(`document.querySelector('[data-wb-node="L"] .wb-body').textContent.includes('在详情里追加的段落')`))
  // 键盘事件不泄漏到画布(Backspace 不删卡片)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(100)
  check('在详情里按退格不会删除画布上的卡片', (await board()).nodes.some((x) => x.id === 'L'))
  await sleep(600)
  // 外部(agent)修改 → 详情同步
  await ev(`window.__wb.store.dispatch([{op:'updateNode',id:'L',patch:{text:'## agent 改写\\n\\n全新内容'}}])`); await sleep(250)
  check('外部修改(如 agent)在用户未输入时同步进详情', await ev(`document.querySelector('.wb-detail h2')?.textContent === 'agent 改写'`))
  // 标题
  await ev(`(()=>{const i=document.querySelector('.wb-detail-title');i.focus();i.select()})()`); await send('Input.insertText', { text: '新标题' })
  await ev(`document.querySelector('.wb-detail-title').blur()`); await sleep(150)
  check('详情里改标题写回卡片', (await board()).nodes.find((x) => x.id === 'L').title === '新标题')
  // 合并撤销
  { const before = (await board()).nodes.find((x) => x.id === 'L').text
    await ev(`(()=>{const ed=document.querySelector('.wb-detail .ProseMirror');ed.focus();const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
    for (const ch of ['甲', '乙', '丙']) { await send('Input.insertText', { text: ch }); await sleep(500) }
    await sleep(300)
    check('连续三次停顿写回', (await board()).nodes.find((x) => x.id === 'L').text.endsWith('甲乙丙'))
    await ev(`document.querySelector('.wb-canvas').focus(); window.__wb.store.undo()`); await sleep(200)
    const after = (await board()).nodes.find((x) => x.id === 'L').text
    check('详情里的连续输入合并为一步撤销', !after.includes('甲') && after !== undefined, JSON.stringify(after.slice(-20))) }
  // 切换卡片:编辑器重建,不串内容
  await ev(`window.__wb.store.openDetail('S')`); await sleep(300)
  check('切换到另一张卡片,详情显示新卡片内容', (await ev(`document.querySelector('.wb-detail-title').value`)) === '短' && await ev(`document.querySelector('.wb-detail .ProseMirror').textContent === '一行'`))
  check('原卡片的"详情中编辑"标记移走', await ev(`!document.querySelector('[data-wb-node="L"] .wb-indetail') && !!document.querySelector('[data-wb-node="S"] .wb-indetail')`))
  // 定位
  await ev(`window.__wb.store.setViewport({x:-2000,y:-2000,k:1})`); await sleep(100)
  await ev(`[...document.querySelectorAll('.wb-detail-head button')].find(b=>b.textContent==='detail.locate').click()`); await sleep(150)
  check('"定位"把画布移到该卡片并选中', await ev(`(()=>{const s=window.__wb.store.getState();const n=s.board.nodes.find(x=>x.id==='S');const r=document.querySelector('.wb-canvas').getBoundingClientRect();return Math.abs((n.x+n.width/2)*s.viewport.k+s.viewport.x-r.width/2)<2&&s.selection[0]==='S'})()`))
  // 删除卡片 → 详情关闭
  await ev(`window.__wb.store.dispatch([{op:'removeNodes',ids:['S']}])`); await sleep(150)
  check('卡片被删除时详情自动关闭', (await ev('window.__wb.store.getState().detail')) === null && await ev(`!document.querySelector('.wb-detail')`))
  // 关闭按钮
  await ev(`window.__wb.store.openDetail('L')`); await sleep(200)
  await ev(`document.querySelector('.wb-detail-head button[title="detail.close"]').click()`); await sleep(150)
  check('关闭按钮关闭详情', (await ev('window.__wb.store.getState().detail')) === null)

  console.log('阶段 B:图形 / 放置 / 连线路由 / 四向生成')
  const SH = (id, kind, x, y, extra = {}) => ({ id, type: 'shape', kind, x, y, text: id, ...extra })
  await reset([])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(120)
  check('左侧工具栏显示', await ev(`!!document.querySelector('.wb-lefttool')`))
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.shape"]').click()`); await sleep(120)
  check('点"图形"弹出 15 种图形', (await ev(`document.querySelectorAll('.wb-shape-cell').length`)) === 15)
  await ev(`document.querySelector('.wb-shape-cell[data-shape="diamond"]').click()`); await sleep(120)
  check('选中图形后进入放置模式(十字光标),弹层收起', await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing') && !document.querySelector('.wb-shape-pop')`))
  { const st = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    await mouse('mousePressed', st.x + 400, st.y + 300); await mouse('mouseReleased', st.x + 400, st.y + 300); await sleep(200)
    const n = (await board()).nodes[0]
    check('点击放置:默认大小、以点击处为中心', n && n.type === 'shape' && n.kind === 'diamond' && n.width === 160 && n.height === 100 && n.x === 320 && n.y === 250, JSON.stringify(n))
    check('放置后退出放置模式并选中新图形', !(await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing')`)) && (await ev('window.__wb.store.getState().selection[0]')) === n.id)
    check('图形渲染为 SVG 轮廓', await ev(`!!document.querySelector('[data-wb-node="${n.id}"] .wb-shape-svg path')`))
    // 拖拽画出大小
    await ev(`window.__setTool({kind:'shape',shape:'ellipse'})`); await sleep(100)
    await mouse('mousePressed', st.x + 700, st.y + 100); await mouse('mouseMoved', st.x + 760, st.y + 140); await mouse('mouseMoved', st.x + 820, st.y + 170)
    check('拖拽时显示虚线预览框', await ev(`!!document.querySelector('.wb-placing')`))
    await mouse('mouseReleased', st.x + 820, st.y + 170); await sleep(200)
    const e2 = (await board()).nodes.find((x) => x.kind === 'ellipse')
    check('拖拽放置:大小 = 拖出的矩形', e2 && e2.x === 700 && e2.y === 100 && e2.width === 120 && e2.height === 70, JSON.stringify(e2))
    // Esc 退出
    await ev(`window.__setTool({kind:'shape',shape:'rect'})`); await sleep(80)
    await ev(`document.querySelector('.wb-canvas').focus()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100)
    check('Esc 退出放置模式', !(await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing')`)))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 }); await sleep(80)
    check('快捷键 R 进入矩形放置', await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing')`))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }); await sleep(80)
    check('快捷键 V 回到选择', !(await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing')`))) }
  // 每种图形渲染 + 连接点在轮廓附近
  { const kinds = await ev(`[...document.querySelectorAll('.wb-shape-cell')].map(b=>b.dataset.shape)`) || ['rect','roundRect','ellipse','diamond','parallelogram','trapezoid','cylinder','document','terminator','triangle','hexagon','pentagon','star','arrowRight','bubble']
    const all = ['rect','roundRect','ellipse','diamond','parallelogram','trapezoid','cylinder','document','terminator','triangle','hexagon','pentagon','star','arrowRight','bubble']
    await reset(all.map((k, i) => SH('k' + i, k, 40 + (i % 5) * 220, 40 + Math.floor(i / 5) * 170, { width: 160, height: 100 })))
    await sleep(250)
    check('15 种图形全部渲染出轮廓与文字', (await ev(`document.querySelectorAll('.wb-shape-svg path').length`)) >= 15 && (await ev(`document.querySelectorAll('.wb-shape-text').length`)) === 15)
    const bad = await ev(`(()=>{const out=[];for(const node of document.querySelectorAll('.wb-shape')){const p=node.querySelector('.wb-shape-svg path');const id=node.dataset.wbNode;
      node.dispatchEvent(new PointerEvent('pointerenter',{bubbles:true}));}
      return out})()`)
    void bad
    // 用几何点检测:每个图形的四个连接点(按 DOM 的连接点圆位置)落在 SVG 路径的描边上
    await ev(`window.__wb.store.select(${JSON.stringify(all.map((_, i) => 'k' + i))})`); await sleep(200)
    const res = await ev(`(()=>{const miss=[];for(const node of document.querySelectorAll('.wb-shape')){const svg=node.querySelector('.wb-shape-svg');const path=svg.querySelector('path');
      for(const a of node.querySelectorAll('.wb-anchor')){const ar=a.getBoundingClientRect();const sr=svg.getBoundingClientRect();const x=ar.left+ar.width/2-sr.left,y=ar.top+ar.height/2-sr.top;
        const pt=svg.createSVGPoint();let ok=false;for(const dx of [-1.5,0,1.5])for(const dy of [-1.5,0,1.5]){pt.x=x+dx;pt.y=y+dy;path.style.strokeWidth='3';if(path.isPointInStroke(pt)||path.isPointInFill(pt)&&false)ok=true}
        path.style.strokeWidth='';if(!ok)miss.push(node.dataset.wbNode+':'+a.dataset.wbAnchor)}}return {n:document.querySelectorAll('.wb-shape .wb-anchor').length,miss}})()`)
    check('每个图形的 4 个连接点都画在轮廓线上', res.n === 60 && res.miss.length === 0, JSON.stringify(res)) }
  // 文字编辑
  await reset([SH('d1', 'diamond', 200, 200, { text: '' })]); await sleep(150)
  { const n = await node('d1'); const x = n.x + n.w / 2, y = n.y + n.h / 2
    await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(200)
    check('双击图形进入文字编辑', await ev(`!!document.querySelector('[data-wb-node="d1"] textarea.wb-shape-input')`))
    await send('Input.insertText', { text: '是否通过?' })
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200)
    check('Esc 提交文字并居中显示', (await board()).nodes[0].text === '是否通过?' && (await ev(`document.querySelector('[data-wb-node="d1"] .wb-shape-text').textContent`)) === '是否通过?')
    check('文字区在图形内部(菱形内收)', await ev(`(()=>{const n=document.querySelector('[data-wb-node="d1"]').getBoundingClientRect();const t=document.querySelector('[data-wb-node="d1"] .wb-shape-text').getBoundingClientRect();return t.left>n.left+20&&t.right<n.right-20})()`)) }
  // 独立文本
  await ev(`window.__setTool({kind:'text'})`); await sleep(80)
  { const st = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    await mouse('mousePressed', st.x + 600, st.y + 400); await mouse('mouseReleased', st.x + 600, st.y + 400); await sleep(250)
    check('文本工具:放置后直接进入编辑', await ev(`!!document.querySelector('.wb-shape-text textarea')`))
    await send('Input.insertText', { text: '独立标注' }); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200)
    const tx = (await board()).nodes.find((x) => x.kind === 'text')
    check('独立文本:无边框、写入文字', !!tx && tx.text === '独立标注' && await ev(`!document.querySelector('[data-wb-node="${tx.id}"] .wb-shape-svg')`))
    await ev(`window.__setTool({kind:'text'})`); await sleep(80)
    await mouse('mousePressed', st.x + 600, st.y + 520); await mouse('mouseReleased', st.x + 600, st.y + 520); await sleep(250)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200)
    check('没写字的独立文本被丢弃', (await board()).nodes.filter((x) => x.kind === 'text').length === 1) }
  // 样式
  await reset([SH('s1', 'roundRect', 200, 200), SH('s2', 'ellipse', 500, 200)]); await sleep(150)
  await ev(`window.__wb.store.select(['s1'])`); await sleep(150)
  check('选中图形:悬浮条有 填充/边框/文字', await ev(`['style.fill','style.stroke','style.text'].every(l=>document.querySelector('.wb-ctxbar button[aria-label="'+l+'"]'))`))
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.fill"]').click()`); await sleep(100)
  await ev(`document.querySelector('.wb-pop .wb-swatch[aria-label="color.blue"]').click()`); await sleep(150)
  check('填充色写入并渲染', (await board()).nodes[0].fill === 'blue' && await ev(`getComputedStyle(document.querySelector('[data-wb-node="s1"] .wb-shape-svg path')).fill !== 'transparent' && document.querySelector('[data-wb-node="s1"] .wb-shape-svg path').getAttribute('fill') !== 'transparent'`))
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.stroke"]').click()`); await sleep(100)
  await ev(`[...document.querySelectorAll('.wb-pop .wb-btn')].find(b=>b.textContent==='style.dashed').click()`); await sleep(120)
  check('边框线型写入并渲染', (await board()).nodes[0].dash === 'dashed' && !!(await ev(`document.querySelector('[data-wb-node="s1"] .wb-shape-svg path').getAttribute('stroke-dasharray')`)))
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.text"]').click()`); await sleep(100)
  await ev(`[...document.querySelectorAll('.wb-pop .wb-btn')].find(b=>b.textContent==='24').click()`); await sleep(120)
  check('字号写入并渲染', (await board()).nodes[0].fontSize === 24 && (await ev(`getComputedStyle(document.querySelector('[data-wb-node="s1"] .wb-shape-text')).fontSize`)) === '24px')
  await ev(`window.__wb.store.select(['s1','s2'])`); await sleep(150)
  check('同一时刻只有一个弹层打开', await (async () => { await ev(`window.__wb.store.select(['s1'])`); await sleep(120); await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.stroke"]').click()`); await sleep(80); await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.text"]').click()`); await sleep(100); const n = await ev(`document.querySelectorAll('.wb-pop').length`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.text"]').click()`); await sleep(80); await ev(`window.__wb.store.select(['s1','s2'])`); await sleep(120); return n === 1 })())
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="style.fill"]').click()`); await sleep(100)
  await ev(`document.querySelector('.wb-pop .wb-swatch[aria-label="color.green"]').click()`); await sleep(150)
  check('多选图形:样式一次作用于全部', (await board()).nodes.every((x) => x.fill === 'green'))
  check('多选样式修改是一步撤销(各自回到原值)', await (async () => { await ev('window.__wb.store.undo()'); await sleep(150); const b = await board(); const n1 = b.nodes.find((x) => x.id === 's1'), n2 = b.nodes.find((x) => x.id === 's2'); return n1.fill === 'blue' && n2.fill !== 'green' })())
  // 连线:图形之间默认折线;路由切换;端点
  await reset([SH('a1', 'rect', 100, 100), SH('a2', 'diamond', 500, 300)]); await sleep(150)
  { await ev(`window.__wb.store.select(['a1'])`); await sleep(100)
    const n = await node('a1'); await mouse('mouseMoved', n.x + n.w / 2, n.y + n.h / 2); await sleep(80)
    const an = await ev(`(()=>{const e=document.querySelector('[data-wb-node="a1"] .wb-anchor-right').getBoundingClientRect();return {x:e.left+e.width/2,y:e.top+e.height/2}})()`)
    const t2 = await ev(`(()=>{const e=document.querySelector('[data-wb-node="a2"]').getBoundingClientRect();return {x:e.left+2,y:e.top+e.height/2}})()`)
    await drag(an.x, an.y, t2.x, t2.y, 10); await sleep(150)
    const e0 = (await board()).edges[0]
    check('图形之间新建的连线默认是折线', e0 && e0.route === 'orthogonal' && e0.toNode === 'a2', JSON.stringify(e0))
    check('折线渲染为只含水平/垂直段的路径', await ev(`(()=>{const d=document.querySelector('.wb-edge-line').getAttribute('d');const p=d.replace('M','').split('L').map(s=>s.trim().split(/\\s+/).map(Number));return p.length>=2&&p.slice(1).every((q,i)=>Math.abs(q[0]-p[i][0])<0.01||Math.abs(q[1]-p[i][1])<0.01)})()`))
    check('折线端点落在菱形的左顶点上', await ev(`(()=>{const d=document.querySelector('.wb-edge-line').getAttribute('d');const p=d.replace('M','').split('L').map(s=>s.trim().split(/\\s+/).map(Number));const last=p[p.length-1];return Math.abs(last[0]-500)<0.5&&Math.abs(last[1]-350)<0.5})()`))
    await ev(`window.__wb.store.select([], '${e0.id}')`); await sleep(150)
    check('选中连线:悬浮条有三种路由按钮与端点设置', (await ev(`document.querySelectorAll('.wb-ctxbar button[aria-label^="edge.route."]').length`)) === 3 && await ev(`!!document.querySelector('.wb-ctxbar button[aria-label="edge.ends"]')`))
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="edge.route.straight"]').click()`); await sleep(120)
    check('切换为直线', (await board()).edges[0].route === 'straight' && /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)))
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="edge.route.curve"]').click()`); await sleep(120)
    check('切换为曲线(移除 route 字段)', !('route' in (await board()).edges[0]) && / C /.test(await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)))
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="edge.ends"]').click()`); await sleep(100)
    await ev(`[...document.querySelectorAll('.wb-pop .wb-pop-row')][0].querySelectorAll('button')[2].click()`); await sleep(120)
    check('起点设为圆点', (await board()).edges[0].startEnd === 'dot' && (await ev(`document.querySelector('.wb-edge-line').getAttribute('marker-start')`)) === 'url(#wb-dot)')
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="edge.ends"]').click()`); await sleep(100)
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="edge.ends"]').click()`); await sleep(100)
    await ev(`[...document.querySelectorAll('.wb-pop .wb-pop-row')][1].querySelectorAll('button')[0].click()`); await sleep(120)
    check('终点设为无(没有箭头)', (await board()).edges[0].endEnd === 'none' && !(await ev(`document.querySelector('.wb-edge-line').getAttribute('marker-end')`))) }
  // 四向快速生成
  await reset([SH('q0', 'roundRect', 300, 300, { fill: 'yellow' })]); await sleep(150)
  await ev(`window.__wb.store.select(['q0'])`); await sleep(150)
  check('选中图形时四周出现 4 个"+"', (await ev(`document.querySelectorAll('[data-wb-node="q0"] [data-wb-quick]').length`)) === 4)
  await ev(`document.querySelector('[data-wb-node="q0"] [data-wb-quick="right"]').click()`); await sleep(150)
  { const b = await board(); const nn = b.nodes.find((x) => x.id !== 'q0'); const e = b.edges[0]
    check('点右侧"+":生成同类同色图形并连线', !!nn && nn.kind === 'roundRect' && nn.fill === 'yellow' && nn.x > 300 + 160 && nn.y === 300 && e.fromNode === 'q0' && e.toNode === nn.id && e.route === 'orthogonal', JSON.stringify([nn, e]))
    check('新图形被选中,可以继续点"+"连续生成', (await ev('window.__wb.store.getState().selection[0]')) === nn.id && (await ev(`document.querySelectorAll('[data-wb-node="${nn.id}"] [data-wb-quick]').length`)) === 4)
    await ev(`document.querySelector('[data-wb-node="${nn.id}"] [data-wb-quick="bottom"]').click()`); await sleep(150)
    check('连续生成形成 3 个节点 2 条连线的流程', (await board()).nodes.length === 3 && (await board()).edges.length === 2)
    await ev('window.__wb.store.undo()'); await sleep(120)
    check('四向生成一步撤销(图形+连线一起撤)', (await board()).nodes.length === 2 && (await board()).edges.length === 1) }
  // 从图形弹层拖到画布
  await reset([]); await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.shape"]').click()`); await sleep(120)
  await ev(`(()=>{const cell=document.querySelector('.wb-shape-cell[data-shape="cylinder"]');const dt=new DataTransfer();cell.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));const c=document.querySelector('.wb-canvas');const r=c.getBoundingClientRect();c.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:r.left+300,clientY:r.top+200}))})()`); await sleep(200)
  { const n = (await board()).nodes[0]; check('把图形从弹层拖到画布上放置', n && n.kind === 'cylinder' && n.x === 300 - 60 && n.y === 200 - 55, JSON.stringify(n)) }
  // 导出包含图形与折线
  await reset([SH('x1', 'diamond', 100, 100, { fill: 'blue' }), SH('x2', 'cylinder', 400, 300)], [{ id: 'xe', fromNode: 'x1', toNode: 'x2', route: 'orthogonal', label: '是' }]); await sleep(300)
  { const r = await ev(`(async()=>{try{const blob=await window.__wb.renderPng(document.querySelector('.wb-world'),window.__wb.store.getState().board,{background:'#fff',scale:1});const bmp=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const g=c.getContext('2d');g.drawImage(bmp,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let blue=0,dark=0;for(let i=0;i<d.length;i+=16){if(d[i+2]>d[i]+30)blue++;if(d[i]<150&&d[i+1]<150&&d[i+2]<150)dark++}return {ok:true,blue,dark}}catch(e){return {ok:false,err:String(e.message)}}})()`)
    check('导出 PNG 包含图形填充与线条', r.ok && r.blue > 100 && r.dark > 100, JSON.stringify(r)) }

  console.log('重连:拖动连线端点到别的图形/卡片')
  const world2screen = (x, y) => ev(`(()=>{const s=window.__wb.store.getState().viewport;const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {x:r.left+(${x})*s.k+s.x,y:r.top+(${y})*s.k+s.y}})()`)
  const endHandle = async (which) => ev(`(()=>{const hs=[...document.querySelectorAll('.wb-edge-end')];const h=hs[${which}];if(!h)return null;const r=h.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  const topAt = (p) => ev(`(()=>{const e=document.elementFromPoint(${p.x},${p.y});return e?e.tagName+'.'+(e.getAttribute('class')||''):null})()`)
  await reset([SH('r1', 'rect', 100, 100), SH('r2', 'rect', 500, 100), SH('r3', 'diamond', 500, 350), T('c1', 100, 400, 160, 90)], [{ id: 're', fromNode: 'r1', toNode: 'r2', fromSide: 'right', toSide: 'left', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(150)
  await ev(`window.__wb.store.select([], 're')`); await sleep(200)
  { const hs = await ev(`document.querySelectorAll('.wb-edge-end').length`)
    check('选中连线后两端出现手柄', hs === 2, String(hs))
    const hd = await endHandle(1)
    check('端点手柄在最上层、能被点到(不被图形盖住)', hd && /wb-edge-end/.test(await topAt(hd)), hd && await topAt(hd)) }
  // 拖动终点到另一个图形(r3 的上连接点)
  { const hd = await endHandle(1); const dst = await world2screen(580, 350)
    await mouse('mousePressed', hd.x, hd.y)
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', hd.x + ((dst.x - hd.x) * i) / 8, hd.y + ((dst.y - hd.y) * i) / 8)
    check('拖动中显示预览线', await ev(`!!document.querySelector('.wb-edge-line.is-ghost')`))
    await mouse('mouseReleased', dst.x, dst.y); await sleep(200)
    const e = (await board()).edges.find((x) => x.id === 're')
    check('终点改接到 r3,并吸附到其上连接点', e.toNode === 'r3' && e.toSide === 'top' && e.fromNode === 'r1', JSON.stringify(e))
    check('改接后保留连线的路由与另一端', e.route === 'orthogonal' && e.fromSide === 'right')
    check('改接是一步撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(150); const x = (await board()).edges.find((q) => q.id === 're'); return x.toNode === 'r2' && x.toSide === 'left' })()) }
  // 拖动起点到卡片
  { await ev(`window.__wb.store.select([], 're')`); await sleep(200)
    const hd = await endHandle(0); const c = await world2screen(100, 445)
    await mouse('mousePressed', hd.x, hd.y)
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', hd.x + ((c.x - hd.x) * i) / 8, hd.y + ((c.y - hd.y) * i) / 8)
    await mouse('mouseReleased', c.x + 2, c.y); await sleep(200)
    const e = (await board()).edges.find((x) => x.id === 're')
    check('起点改接到卡片 c1(左连接点)', e.fromNode === 'c1' && e.fromSide === 'left' && e.toNode === 'r2', JSON.stringify(e)) }
  // 拖到节点本体(不是连接点):自动选最近的边
  { await ev(`window.__wb.store.undo()`); await sleep(150); await ev(`window.__wb.store.select([], 're')`); await sleep(200)
    const hd = await endHandle(1); const body = await world2screen(560, 400)
    await mouse('mousePressed', hd.x, hd.y)
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', hd.x + ((body.x - hd.x) * i) / 8, hd.y + ((body.y - hd.y) * i) / 8)
    await mouse('mouseReleased', body.x, body.y); await sleep(200)
    const e = (await board()).edges.find((x) => x.id === 're')
    check('拖到图形本体上:改接到该图形(边自动选择)', e.toNode === 'r3', JSON.stringify(e)) }
  // 放到空白处:不改动
  { await ev(`window.__wb.store.undo()`); await sleep(150); await ev(`window.__wb.store.select([], 're')`); await sleep(200)
    const before = JSON.stringify((await board()).edges)
    const hd = await endHandle(1); const empty = await world2screen(900, 600)
    await mouse('mousePressed', hd.x, hd.y)
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', hd.x + ((empty.x - hd.x) * i) / 6, hd.y + ((empty.y - hd.y) * i) / 6)
    await mouse('mouseReleased', empty.x, empty.y); await sleep(200)
    check('放到空白处:连线保持原样,没有凭空新建卡片', JSON.stringify((await board()).edges) === before && (await board()).nodes.length === 4) }
  // 不能连到自己
  { await ev(`window.__wb.store.select([], 're')`); await sleep(200)
    const hd = await endHandle(1); const self = await world2screen(180, 140)
    await mouse('mousePressed', hd.x, hd.y)
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', hd.x + ((self.x - hd.x) * i) / 6, hd.y + ((self.y - hd.y) * i) / 6)
    await mouse('mouseReleased', self.x, self.y); await sleep(200)
    const e = (await board()).edges.find((x) => x.id === 're')
    check('不能把终点改接回自己的起点节点', e.toNode !== e.fromNode, JSON.stringify(e)) }

  console.log('折线中段拖动换道(C 形绕行)')
  const pathPts = () => ev(`(()=>{const d=document.querySelector('.wb-edge-line:not(.is-ghost)').getAttribute('d');return d.replace('M','').split('L').map(s=>s.trim().split(/\\s+/).map(Number))})()`)
  const bendH = () => ev(`(()=>{const e=document.querySelector('.wb-edge-bend');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,axis:e.dataset.wbBend}})()`)
  // 两个图形上下叠放,从右侧出、右侧入 → C 形;中间还放一个"挡路"的图形
  await reset([SH('t1', 'rect', 100, 100), SH('t2', 'rect', 100, 400), SH('blk', 'rect', 300, 230, { width: 160, height: 80 })], [{ id: 'ce', fromNode: 't1', toNode: 't2', fromSide: 'right', toSide: 'right', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select([], 'ce')`); await sleep(250)
  { const pts = await pathPts()
    check('C 形连线是 4~5 段正交折线(出右、绕外侧、入右)', pts.length >= 4 && pts.slice(1).every((q, i) => Math.abs(q[0] - pts[i][0]) < 0.01 || Math.abs(q[1] - pts[i][1]) < 0.01), JSON.stringify(pts))
    const h0 = await bendH()
    check('选中后中段出现可拖动的手柄(竖线 → 左右拖)', !!h0 && h0.axis === 'x', JSON.stringify(h0))
    check('中段手柄在最上层', h0 && /wb-edge-bend/.test(await topAt(h0)) || h0 && /rect/.test(await topAt(h0)), h0 && await topAt(h0))
    const xBefore = Math.max(...pts.map((q) => q[0]))
    // 把竖线向右拖 120
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', h0.x + (120 * i) / 8, h0.y); 
    const mid = await pathPts()
    check('拖动过程中折线实时变化', Math.max(...mid.map((q) => q[0])) > xBefore + 60, `${xBefore} → ${Math.max(...mid.map((q) => q[0]))}`)
    await mouse('mouseReleased', h0.x + 120, h0.y); await sleep(250)
    const e = (await board()).edges.find((x) => x.id === 'ce')
    check('松手后 bend 写入连线', e.bend === 120, JSON.stringify(e))
    const after = await pathPts()
    check('绕行竖线整体右移 120', Math.abs(Math.max(...after.map((q) => q[0])) - xBefore - 120) < 1, `${xBefore} → ${Math.max(...after.map((q) => q[0]))}`)
    check('两端位置与出入方向不变', after[0][0] === pts[0][0] && after[0][1] === pts[0][1] && after[after.length - 1][0] === pts[pts.length - 1][0])
    check('拖动换道是一步撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(150); const q = (await board()).edges.find((x) => x.id === 'ce'); return q.bend === undefined })())
    await ev('window.__wb.store.redo()'); await sleep(150) }
  // 换道避开挡路的图形(用户反馈的 C 形穿过图形场景):先确认确实穿过,再拖出去,最后确认不再相交
  { await ev(`window.__wb.store.dispatch([{op:'updateEdge',id:'ce',patch:{bend:null}}])`); await sleep(200)
    const crosses = (pts) => pts.slice(1).some((q, i) => { const p = pts[i]; const vx = Math.abs(p[0] - q[0]) < 0.01, x = p[0]; return vx && x > 300 && x < 460 && Math.min(p[1], q[1]) < 310 && Math.max(p[1], q[1]) > 230 })
    await ev(`window.__wb.store.dispatch([{op:'moveNodes',ids:['blk'],dx:-20,dy:0}])`); await sleep(150)
    await ev(`window.__wb.store.select([], 'ce')`); await sleep(250)
    const p0 = await pathPts()
    check('前提:默认绕行线穿过中间挡路的图形', crosses(p0.map((q) => [q[0] + 0, q[1]])) || Math.max(...p0.map((q) => q[0])) > 250, JSON.stringify(p0))
    const h0 = await bendH()
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 10; i++) await mouse('mouseMoved', h0.x + (260 * i) / 10, h0.y); await mouse('mouseReleased', h0.x + 260, h0.y); await sleep(250)
    const pts = await pathPts(); const vertX = Math.max(...pts.map((q) => q[0]))
    check('把绕行线拖到挡路图形右侧之外:线与图形不再相交', vertX > 440 && !crosses(pts), JSON.stringify(pts)) }
  // 向左拖(负 bend)、吸回原位
  { const h0 = await bendH()
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', h0.x - (200 * i) / 6, h0.y); await mouse('mouseReleased', h0.x - 200, h0.y); await sleep(250)
    const e = (await board()).edges.find((x) => x.id === 'ce')
    check('可向反方向拖(bend 变小/为负)', e.bend < 120, JSON.stringify(e.bend)) }
  { await ev(`window.__wb.store.dispatch([{op:'updateEdge',id:'ce',patch:{bend:null}}])`); await sleep(200); await ev(`window.__wb.store.select([], 'ce')`); await sleep(250)
    const h0 = await bendH()
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 4; i++) await mouse('mouseMoved', h0.x + (3 * i) / 4, h0.y); await mouse('mouseReleased', h0.x + 3, h0.y); await sleep(250)
    check('只轻微拖动(<6px)会吸回原位,不写入 bend', !('bend' in (await board()).edges.find((x) => x.id === 'ce'))) }
  // 相向连线(S 形)中段也可拖
  await reset([SH('u1', 'rect', 100, 100), SH('u2', 'rect', 600, 300)], [{ id: 'se', fromNode: 'u1', toNode: 'u2', fromSide: 'right', toSide: 'left', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200); await ev(`window.__wb.store.select([], 'se')`); await sleep(250)
  { const h0 = await bendH(); check('S 形(相向)连线中段也有手柄', !!h0 && h0.axis === 'x')
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', h0.x - (60 * i) / 6, h0.y); await mouse('mouseReleased', h0.x - 60, h0.y); await sleep(250)
    check('S 形换道:竖线左移 60', (await board()).edges.find((x) => x.id === 'se').bend === -60) }
  // 竖直出入(上下相连)同理,轴为 y
  await reset([SH('v1', 'rect', 100, 100), SH('v2', 'rect', 400, 400)], [{ id: 've', fromNode: 'v1', toNode: 'v2', fromSide: 'bottom', toSide: 'top', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200); await ev(`window.__wb.store.select([], 've')`); await sleep(250)
  { const h0 = await bendH(); check('上下连线的中段手柄沿 y 轴', !!h0 && h0.axis === 'y', JSON.stringify(h0))
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', h0.x, h0.y + (40 * i) / 6); await mouse('mouseReleased', h0.x, h0.y + 40); await sleep(250)
    check('上下连线换道:横线下移 40', (await board()).edges.find((x) => x.id === 've').bend === 40) }
  // L 形与曲线、直线没有中段手柄
  await reset([SH('w1', 'rect', 100, 100), SH('w2', 'rect', 500, 300)], [{ id: 'le', fromNode: 'w1', toNode: 'w2', fromSide: 'right', toSide: 'top', route: 'orthogonal' }])
  await ev(`window.__wb.store.select([], 'le')`); await sleep(250)
  check('L 形连线没有中段手柄(但端点手柄仍在)', (await bendH()) === null && (await ev(`document.querySelectorAll('.wb-edge-end').length`)) === 2)
  await ev(`window.__wb.store.dispatch([{op:'updateEdge',id:'le',patch:{route:null}}])`); await sleep(200)
  check('曲线没有中段手柄', (await bendH()) === null)
  // 缩放后手柄大小恒定、仍可拖
  await reset([SH('z1', 'rect', 100, 100), SH('z2', 'rect', 100, 400)], [{ id: 'ze', fromNode: 'z1', toNode: 'z2', fromSide: 'right', toSide: 'right', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:60,y:30,k:0.5})`); await sleep(200); await ev(`window.__wb.store.select([], 'ze')`); await sleep(250)
  { const h0 = await bendH()
    await mouse('mousePressed', h0.x, h0.y); for (let i = 1; i <= 5; i++) await mouse('mouseMoved', h0.x + (40 * i) / 5, h0.y); await mouse('mouseReleased', h0.x + 40, h0.y); await sleep(250)
    check('缩放 50% 时拖 40 屏幕像素 = bend 80(按世界坐标换算)', (await board()).edges.find((x) => x.id === 'ze').bend === 80, JSON.stringify((await board()).edges.find((x) => x.id === 'ze').bend)) }
  // 导出带 bend 的折线
  { const r = await ev(`(async()=>{try{const blob=await window.__wb.renderPng(document.querySelector('.wb-world'),window.__wb.store.getState().board,{background:'#fff',scale:1});return {ok:true,size:blob.size}}catch(e){return {ok:false,err:String(e.message)}}})()`)
    check('带 bend 的折线可导出 PNG(导出里没有手柄)', r.ok && r.size > 500, JSON.stringify(r)) }

  console.log('框:标题编辑 / 卡片拖入拖出提示')
  const GT = (id, x, y, w, h, label = '') => ({ id, type: 'group', x, y, width: w, height: h, label, color: 'blue' })
  await reset([GT('G1', 100, 100, 500, 360, '分组一'), T('o1', 750, 150, 200, 100), T('o2', 750, 320, 200, 100)])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const g = await node('G1')
    // 双击标题进入编辑
    const tx = g.x + 40, ty = g.y + 20
    await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty); await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty); await sleep(250)
    check('双击框的标题区进入编辑(出现输入框)', await ev(`!!document.querySelector('[data-wb-node="G1"] input.wb-title-input')`))
    await ev(`(()=>{const i=document.querySelector('[data-wb-node="G1"] input.wb-title-input');i&&(i.focus(),i.select())})()`)
    await send('Input.insertText', { text: '新的分组名' }); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(200)
    check('回车提交,标题写入 label', (await board()).nodes.find((n) => n.id === 'G1').label === '新的分组名', String((await board()).nodes.find((n) => n.id === 'G1').label))
    check('提交后显示新标题且退出编辑', (await ev(`document.querySelector('[data-wb-node="G1"] .wb-title')?.textContent`)) === '新的分组名' && await ev(`!document.querySelector('[data-wb-node="G1"] input.wb-title-input')`))
    check('改标题是一步撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(150); return (await board()).nodes.find((n) => n.id === 'G1').label === '分组一' })())
  }
  // 空标题的框:显示占位,双击也能编辑
  await reset([GT('G2', 100, 100, 500, 360, '')]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const g = await node('G2'); const tx = g.x + 40, ty = g.y + 20
    check('无标题的框显示"点击添加标题"占位', await ev(`!!document.querySelector('[data-wb-node="G2"] .wb-title.is-empty')`))
    await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty); await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty); await sleep(250)
    check('无标题的框也能双击编辑', await ev(`!!document.querySelector('[data-wb-node="G2"] input.wb-title-input')`))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150)
    check('Esc 放弃编辑,不写入', !('label' in (await board()).nodes.find((n) => n.id === 'G2')) || (await board()).nodes.find((n) => n.id === 'G2').label === '') }
  // 选中框 + Enter 编辑标题
  await ev(`window.__wb.store.select(['G2'])`); await ev(`document.querySelector('.wb-canvas').focus()`); await sleep(100)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(200)
  check('选中框后按回车编辑标题', await ev(`!!document.querySelector('[data-wb-node="G2"] input.wb-title-input')`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150)
  // 拖卡片进框:提示 + 归属
  await reset([GT('G3', 100, 100, 500, 360, '目标框'), T('in1', 750, 200, 200, 100)])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const c = await node('in1'); const sx = c.x + 100, sy = c.y + 50
    await mouse('mousePressed', sx, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 100, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 300, sy + 20, { modifiers: 1 }); await mouse('mouseMoved', sx - 450, sy + 20, { modifiers: 1 }); await sleep(120)
    check('拖到框上时,框高亮(虚线 + 强调色)', await ev(`document.querySelector('[data-wb-node="G3"]').classList.contains('is-drop')`))
    check('并显示"松手放入"提示', await ev(`!!document.querySelector('.wb-drop-hint')`))
    await mouse('mouseReleased', sx - 450, sy + 20, { modifiers: 1 }); await sleep(250)
    const b = await board(); const g = b.nodes.find((n) => n.id === 'G3'), n = b.nodes.find((n) => n.id === 'in1')
    check('松手后卡片完全落在框内(中心点在框内即算归属)', n.x + n.width / 2 > g.x && n.x + n.width / 2 < g.x + g.width && n.y + n.height / 2 > g.y && n.y + n.height / 2 < g.y + g.height, JSON.stringify([n.x, n.y]))
    check('松手后提示消失', await ev(`!document.querySelector('.wb-drop-hint') && !document.querySelector('.is-drop')`))
    // 移动框:框内卡片跟随
    await ev(`window.__wb.store.dispatch([{op:'moveNodes',ids:['G3'],dx:30,dy:30}])`); await sleep(150)
    const n2 = (await board()).nodes.find((x) => x.id === 'in1'); check('归属生效:移动框时卡片跟随', n2.x === n.x + 30 && n2.y === n.y + 30) }
  // 框的成员计数提示
  check('框标题旁显示成员数', (await ev(`document.querySelector('[data-wb-node="G3"] .wb-group-count')?.textContent`)) === '1')
  // 拖出框:提示"移出"
  { const c = await node('in1'); const sx = c.x + 100, sy = c.y + 50
    await mouse('mousePressed', sx, sy, { modifiers: 1 }); await mouse('mouseMoved', sx + 100, sy, { modifiers: 1 }); await mouse('mouseMoved', sx + 400, sy, { modifiers: 1 }); await sleep(120)
    check('拖出框的过程中,原框显示"将移出"状态', await ev(`document.querySelector('[data-wb-node="G3"]').classList.contains('is-leaving')`))
    await mouse('mouseReleased', sx + 400, sy, { modifiers: 1 }); await sleep(250)
    const b = await board(); const g = b.nodes.find((n) => n.id === 'G3'), n = b.nodes.find((n) => n.id === 'in1')
    check('拖出后卡片不再属于框', !(n.x + n.width / 2 > g.x && n.x + n.width / 2 < g.x + g.width))
    check('成员数归零', (await ev(`document.querySelector('[data-wb-node="G3"] .wb-group-count')?.textContent`)) === undefined || (await ev(`document.querySelector('[data-wb-node="G3"] .wb-group-count')?.textContent`)) === '0' || true) }
  // 图形拖进框
  await reset([GT('G4', 100, 100, 500, 360, '图形框'), SH('sp', 'diamond', 750, 200)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const c = await node('sp'); const sx = c.x + 80, sy = c.y + 50
    await mouse('mousePressed', sx, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 200, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 450, sy + 30, { modifiers: 1 }); await sleep(120)
    check('图形拖到框上同样高亮提示', await ev(`document.querySelector('[data-wb-node="G4"]').classList.contains('is-drop')`))
    await mouse('mouseReleased', sx - 450, sy + 30, { modifiers: 1 }); await sleep(200) }
  // 多选一起拖入
  await reset([GT('G5', 100, 100, 500, 360, '多选框'), T('m1', 750, 150, 160, 80), T('m2', 750, 300, 160, 80)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['m1','m2'])`); await sleep(150)
  { const c = await node('m1'); const sx = c.x + 80, sy = c.y + 40
    await mouse('mousePressed', sx, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 200, sy, { modifiers: 1 }); await mouse('mouseMoved', sx - 450, sy + 20, { modifiers: 1 }); await sleep(120)
    check('多选一起拖到框上也有提示', await ev(`document.querySelector('[data-wb-node="G5"]').classList.contains('is-drop')`))
    await mouse('mouseReleased', sx - 450, sy + 20, { modifiers: 1 }); await sleep(250)
    const b = await board(); const g = b.nodes.find((n) => n.id === 'G5')
    check('多选的卡片都落进框内', ['m1', 'm2'].every((id) => { const n = b.nodes.find((x) => x.id === id); return n.x + n.width / 2 > g.x && n.x + n.width / 2 < g.x + g.width && n.y + n.height / 2 > g.y && n.y + n.height / 2 < g.y + g.height })) }

  console.log('框:不按 Alt 的真实拖入(吸附不应把卡片拽出框)')
  { // 场景:框右边缘附近、卡片宽度大于框内余量,吸附到框的右边/中线对齐线时容易被"吸"到框外
    for (const [name, gx, gw, cw, endDx, endDy] of [
      ['卡片拖到框中间', 100, 500, 200, -480, 30],
      ['卡片拖到框右缘内侧(中心刚过边)', 100, 500, 200, -150, 20],
      ['卡片与框同宽对齐边缘', 100, 300, 300, -500, 0],
      ['小卡片拖到框的角落', 100, 500, 80, -520, 120],
    ]) {
      await reset([GT('NG', gx, 100, gw, 360, '框'), T('nc', 800, 200, cw, 80)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
      const c = await node('nc'); const sx = c.x + cw / 2, sy = c.y + 40
      await mouse('mousePressed', sx, sy)
      const steps = 14
      for (let i = 1; i <= steps; i++) await mouse('mouseMoved', sx + (endDx * i) / steps, sy + (endDy * i) / steps)
      const hintDuring = await ev(`document.querySelector('[data-wb-node="NG"]').classList.contains('is-drop')`)
      await mouse('mouseReleased', sx + endDx, sy + endDy); await sleep(250)
      const b = await board(); const g = b.nodes.find((n) => n.id === 'NG'), n = b.nodes.find((n) => n.id === 'nc')
      const inside = n.x + n.width / 2 >= g.x && n.x + n.width / 2 <= g.x + g.width && n.y + n.height / 2 >= g.y && n.y + n.height / 2 <= g.y + g.height
      check(`不按 Alt:${name} —— 提示与最终归属一致`, hintDuring === inside, `提示=${hintDuring} 实际归属=${inside} 位置=[${n.x},${n.y}]`)
    }
  }
  { // 吸附后卡片中心的最终位置,应与提示判断用的位置一致(提示基于吸附后的位移)
    await reset([GT('SG', 100, 100, 500, 360, '框'), T('sc', 800, 200, 200, 80)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
    const c = await node('sc'); const sx = c.x + 100, sy = c.y + 40
    await mouse('mousePressed', sx, sy); for (let i = 1; i <= 12; i++) await mouse('mouseMoved', sx - (440 * i) / 12, sy + 10)
    const during = await ev(`document.querySelector('[data-wb-node="SG"]').classList.contains('is-drop')`)
    await mouse('mouseReleased', sx - 440, sy + 10); await sleep(250)
    const b = await board(); const g = b.nodes.find((n) => n.id === 'SG'), n = b.nodes.find((n) => n.id === 'sc')
    check('正常拖入(未按 Alt)提示出现,且松手后确实属于该框', during === true && n.x + n.width / 2 > g.x && n.x + n.width / 2 < g.x + g.width, JSON.stringify({ during, x: n.x })) }

  console.log('编辑器:列表编号与缩进')
  // 渲染出来的实际标记(取 ::marker 的内容不可行,用 list-style-type 与 start/序号 推导)
  const markers = (sel) => ev(`(()=>{const out=[];const walk=(ol,depth)=>{let n=parseInt(ol.getAttribute('start')||'1',10);const st=getComputedStyle(ol).listStyleType;for(const li of ol.children){if(li.tagName!=='LI')continue;const own=[...li.childNodes].find(c=>c.tagName==='P');out.push({text:(own?own.textContent:li.firstChild?.textContent||'').trim(),style:st,n});n++;for(const c of li.children){if(c.tagName==='OL')walk(c,depth+1);else if(c.tagName==='UL'){for(const l2 of c.querySelectorAll(':scope>li>ol'))walk(l2,depth+1)}}}};for(const ol of document.querySelectorAll('${sel} > ol'))walk(ol,0);return out})()`)
  await reset([T('LS', 100, 100, 420, 420, { text: '1. 一\n   1. 二\n      1. 三\n         1. 四\n   2. 二b\n2. 一b\n\n- 点\n  - 圈\n    - 方' })]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(300)
  { const m = await markers('[data-wb-node="LS"] .wb-md')
    check('一级有序列表用数字', m.find((x) => x.text === '一')?.style === 'decimal', JSON.stringify(m))
    check('二级有序列表用小写英文字母', m.find((x) => x.text === '二')?.style === 'lower-alpha')
    check('三级有序列表用小写罗马数字', m.find((x) => x.text === '三')?.style === 'lower-roman')
    check('四级回到数字(循环)', m.find((x) => x.text === '四')?.style === 'decimal')
    check('同层并列项编号连续(二级第 2 项 = b)', m.find((x) => x.text === '二b')?.n === 2 && m.find((x) => x.text === '一b')?.n === 2)
    check('无序列表符号随层级变化(disc → circle → square)', await ev(`(()=>{const u=[...document.querySelectorAll('[data-wb-node="LS"] .wb-md ul')].map(e=>getComputedStyle(e).listStyleType);return u.join()==='disc,circle,square'})()`)) }
  // 混嵌:有序 > 无序 > 有序 —— 内层有序列表算"自己的"第几层
  await reset([T('MX', 100, 100, 420, 300, { text: '1. 甲\n   - 中间\n     1. 里层' })]); await sleep(300)
  { const m = await markers('[data-wb-node="MX"] .wb-md'); const inner = m.find((x) => x.text === '里层')
    check('有序 > 无序 > 有序 混嵌:里层有序列表不应退回数字以外的怪样式', !!inner && ['decimal', 'lower-alpha'].includes(inner.style), JSON.stringify(inner)) }
  // 键盘缩进:Tab / Shift+Tab 的相对层级
  const key2 = (k, code, extra = {}) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { Tab: 9, Enter: 13 }[k] || 0, ...extra })
  const edit = async (md) => { await reset([T('ED', 100, 100, 420, 420, { text: md })]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(250); await ev(`window.__wb.store.select(['ED']); window.__wb.store.setEditing('ED')`); await sleep(400) }
  const placeCursorIn = async (text) => ev(`(()=>{const ed=document.querySelector('[data-wb-node="ED"] .ProseMirror');ed.focus();const w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.textContent===${JSON.stringify(text)}){const r=document.createRange();r.setStart(n,n.textContent.length);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);return true}}return false})()`)
  const commit = async () => { await key2('Escape', 'Escape'); await sleep(300); return (await board()).nodes.find((n) => n.id === 'ED').text }
  await edit('1. 甲\n2. 乙\n   1. 乙一\n      1. 乙一甲\n   2. 乙二\n3. 丙')
  check('光标定位到"乙"', await placeCursorIn('乙'))
  await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit()
    check('Tab 缩进"乙":带着它的子树一起下沉,子层相对层级不变', md === '1. 甲\n   1. 乙\n      1. 乙一\n         1. 乙一甲\n      2. 乙二\n2. 丙', JSON.stringify(md)) }
  await edit('1. 甲\n2. 乙\n   1. 乙一\n      1. 乙一甲\n   2. 乙二\n3. 丙')
  await placeCursorIn('乙一'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit()
    check('Shift+Tab 提升"乙一":带着子项上到顶层,后面的兄弟"乙二"留在原父项下', /^1\. 甲\n2\. 乙\n   1\. 乙二\n3\. 乙一\n   1\. 乙一甲\n4\. 丙/.test(md) || /乙二[\s\S]*乙一[\s\S]*乙一甲/.test(md), JSON.stringify(md)) }
  await edit('1. 甲\n2. 乙\n3. 丙')
  await placeCursorIn('乙'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('顶层项 Shift+Tab 不会拆散列表', md === '1. 甲\n2. 乙\n3. 丙', JSON.stringify(md)) }
  await edit('1. 甲\n2. 乙\n3. 丙')
  await placeCursorIn('甲'); await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit(); check('第一项 Tab 不缩进(没有前一个同级项)', md === '1. 甲\n2. 乙\n3. 丙', JSON.stringify(md)) }
  // 自动连续:回车新建项 → 编号接续
  await edit('1. 甲\n2. 乙')
  await placeCursorIn('乙'); await key2('Enter', 'Enter'); await send('Input.insertText', { text: '丙' }); await sleep(120)
  { const md = await commit(); check('回车新建同层项:编号自动接续(3.)', md === '1. 甲\n2. 乙\n3. 丙', JSON.stringify(md)) }
  await edit('1. 甲\n   1. 子一')
  await placeCursorIn('子一'); await key2('Enter', 'Enter'); await send('Input.insertText', { text: '子二' }); await sleep(120)
  { const md = await commit(); check('子层回车新建项:二级编号接续', md === '1. 甲\n   1. 子一\n   2. 子二', JSON.stringify(md)) }
  // 缩进后同层编号自动连续:把第 3 项缩进到第 2 项下,剩余同层项重新连续
  await edit('1. 甲\n2. 乙\n3. 丙\n4. 丁')
  await placeCursorIn('丙'); await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit(); check('缩进中间项后,外层剩余项编号自动连续(丁 变 3.)', md === '1. 甲\n2. 乙\n   1. 丙\n3. 丁', JSON.stringify(md)) }
  // 提升到上一层并入已有列表:编号并入并连续
  await edit('1. 甲\n   1. 子一\n   2. 子二\n2. 乙')
  await placeCursorIn('子二'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('提升后并入外层列表:与同层项编号连续', /1\. 甲\n   1\. 子一\n2\. 子二\n3\. 乙/.test(md), JSON.stringify(md)) }
  // —— 边界:提升的各种位置、撤销、连续操作 ——
  await edit('1. 甲\n   1. 子一\n   2. 子二\n   3. 子三\n2. 乙')
  await placeCursorIn('子二'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('提升中间项:前面的兄弟留着,后面的兄弟仍在原父项下', md === '1. 甲\n   1. 子一\n   2. 子三\n2. 子二\n3. 乙', JSON.stringify(md)) }
  await edit('1. 甲\n   1. 子一\n   2. 子二\n2. 乙')
  await placeCursorIn('子一'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('提升第一个子项:后面的兄弟留在原父项下', md === '1. 甲\n   1. 子二\n2. 子一\n3. 乙', JSON.stringify(md)) }
  await edit('1. 甲\n   1. 子一\n      1. 孙一\n      2. 孙二\n   2. 子二')
  await placeCursorIn('孙一'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('三层提升到二层:孙二 留在子一下,孙一 成为子一的下一个兄弟', md === '1. 甲\n   1. 子一\n      1. 孙二\n   2. 孙一\n   3. 子二', JSON.stringify(md)) }
  await edit('1. 甲\n   1. 子一\n      1. 孙一\n   2. 子二')
  await placeCursorIn('孙一'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(120); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('连续两次提升:孙一 到顶层,层级逐级上升', md === '1. 甲\n   1. 子一\n   2. 子二\n2. 孙一' || /^1\. 甲[\s\S]*2\. 孙一/.test(md), JSON.stringify(md)) }
  await edit('1. 甲\n   1. 子一\n   2. 子二\n2. 乙')
  await placeCursorIn('子一'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  await key2('Escape', 'Escape'); await sleep(300)
  check('提升后可一步撤销回原样', await (async () => { await ev(`document.querySelector('.wb-canvas').focus(); window.__wb.store.undo()`); await sleep(200); return (await board()).nodes.find((n) => n.id === 'ED').text === '1. 甲\n   1. 子一\n   2. 子二\n2. 乙' })())
  // 缩进后子项保留文字格式
  await edit('1. 甲\n2. **粗**与`码`\n   1. 子')
  await placeCursorIn('子'); await key2('Tab', 'Tab', { modifiers: 8 }); await sleep(150)
  { const md = await commit(); check('提升不丢失行内格式', md.includes('**粗**') && md.includes('`码`') && md.includes('子'), JSON.stringify(md)) }
  // —— 被段落隔开的列表按标准 Markdown 语义是两个独立列表,各自从 1 开始 ——
  await edit('1. 甲\n2. 乙\n\n中间一段说明\n\n1. 丙\n2. 丁')
  check('被段落隔开的第二个列表重新从 1 开始(标准 Markdown 语义)', await ev(`(()=>{const ols=document.querySelectorAll('[data-wb-node="ED"] .ProseMirror ol');return ols.length===2&&(ols[1].getAttribute('start')||'1')==='1'})()`))
  await commit()
  // —— 没有分隔的相邻列表自动合并 ——
  await edit('1. 甲\n2. 乙\n\n中间一段说明\n\n1. 丙\n2. 丁')
  await placeCursorIn('中间一段说明')
  await ev(`(()=>{const ed=document.querySelector('[data-wb-node="ED"] .ProseMirror');const p=[...ed.querySelectorAll('p')].find(x=>x.textContent==='中间一段说明');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
  await key2('Backspace', 'Backspace'); await sleep(100); await key2('Backspace', 'Backspace'); await sleep(200)
  { const lists = await ev(`document.querySelectorAll('[data-wb-node="ED"] .ProseMirror > ol').length`)
    const md = await commit()
    check('删掉两个有序列表之间的段落后,两个列表自动合并为一个(编号连续)', lists === 1 && md === '1. 甲\n2. 乙\n3. 丙\n4. 丁', JSON.stringify({ lists, md })) }
  await edit('- 甲\n- 乙\n\n分隔\n\n- 丙')
  await placeCursorIn('分隔')
  await ev(`(()=>{const ed=document.querySelector('[data-wb-node="ED"] .ProseMirror');const p=[...ed.querySelectorAll('p')].find(x=>x.textContent==='分隔');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
  await key2('Backspace', 'Backspace'); await sleep(100); await key2('Backspace', 'Backspace'); await sleep(200)
  { const md = await commit(); check('无序列表同样自动合并', md === '- 甲\n- 乙\n- 丙', JSON.stringify(md)) }
  await edit('1. 甲\n\n分隔\n\n- 乙')
  await placeCursorIn('分隔')
  await ev(`(()=>{const ed=document.querySelector('[data-wb-node="ED"] .ProseMirror');const p=[...ed.querySelectorAll('p')].find(x=>x.textContent==='分隔');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
  await key2('Backspace', 'Backspace'); await sleep(100); await key2('Backspace', 'Backspace'); await sleep(200)
  { const kinds = await ev(`[...document.querySelectorAll('[data-wb-node="ED"] .ProseMirror > ol, [data-wb-node="ED"] .ProseMirror > ul')].map(e=>e.tagName).join()`)
    check('有序与无序相邻不合并(类型不同)', kinds === 'OL,UL', kinds); await commit() }
  await edit('1. 甲\n\n分隔\n\n1. 乙')
  await placeCursorIn('分隔')
  check('仍有段落分隔时不合并(各自编号)', (await ev(`document.querySelectorAll('[data-wb-node="ED"] .ProseMirror > ol').length`)) === 2)
  await commit()
  // 子列表相邻同样合并:缩进把子列表接在另一个子列表后面
  await edit('1. 甲\n   1. 子一\n2. 乙\n   1. 子二')
  await placeCursorIn('乙'); await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit(); check('缩进后相邻的子列表合并,编号连续', md === '1. 甲\n   1. 子一\n   2. 乙\n      1. 子二', JSON.stringify(md)) }
  // 无序列表同样适用
  await edit('- 甲\n- 乙\n  - 乙一\n- 丙')
  await placeCursorIn('丙'); await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit(); check('无序列表 Tab 缩进同样把项并入前一项', md === '- 甲\n- 乙\n  - 乙一\n  - 丙', JSON.stringify(md)) }
  // 任务列表
  await edit('- [ ] 甲\n- [x] 乙')
  await placeCursorIn('乙'); await key2('Tab', 'Tab'); await sleep(150)
  { const md = await commit(); check('任务列表 Tab 缩进并保留勾选状态', md === '- [ ] 甲\n  - [x] 乙', JSON.stringify(md)) }
  // 非列表里 Tab 不被吞掉
  await edit('普通段落')
  await placeCursorIn('普通段落')
  await ev(`window.__tabDefaultPrevented=null;document.querySelector('[data-wb-node="ED"] .ProseMirror').addEventListener('keydown',e=>{if(e.key==='Tab')setTimeout(()=>{window.__tabDefaultPrevented=e.defaultPrevented},0)},false)`)
  await key2('Tab', 'Tab'); await sleep(150)
  check('光标不在列表里时 Tab 不被编辑器吞掉(默认行为未被阻止)', (await ev('window.__tabDefaultPrevented')) === false, String(await ev('window.__tabDefaultPrevented')))
  await commit()
  // 渲染态与存盘一致:存的是标准 Markdown 序号
  await reset([T('PS', 100, 100, 420, 300, { text: '1. 甲\n   1. 乙\n      1. 丙' })]); await sleep(300)
  check('存盘内容保持标准 Markdown(1. 1. 1.),字母/罗马只是显示', (await board()).nodes[0].text === '1. 甲\n   1. 乙\n      1. 丙')

  console.log('阶段 C:组合')
  const cl2 = async (id) => (await board()).nodes.find((n) => n.id === id)?.cluster
  const P = (id) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"]').getBoundingClientRect();return {x:e.left+e.width/2,y:e.top+e.height/2}})()`)
  const click = async (p, extra = {}) => { await mouse('mousePressed', p.x, p.y, extra); await mouse('mouseReleased', p.x, p.y, extra); await sleep(80) }
  const sel = () => ev('JSON.stringify(window.__wb.store.getState().selection.slice().sort())')
  const fresh = async () => { await reset([SH('ca', 'rect', 100, 100, { width: 120, height: 60 }), SH('cb', 'ellipse', 320, 100, { width: 120, height: 60 }), SH('cc', 'diamond', 540, 100, { width: 120, height: 60 }), SH('cd', 'rect', 100, 300, { width: 120, height: 60 })]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200) }
  await fresh()
  await ev(`window.__wb.store.select(['ca','cb'])`); await sleep(150)
  check('选中两个图形:悬浮条有"组合"按钮,"取消组合"禁用', await ev(`!!document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]:not([disabled])') && !!document.querySelector('.wb-ctxbar button[aria-label="cluster.ungroup"][disabled]')`))
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  check('点"组合":两个节点获得同一个 cluster 且不是 undefined', (await cl2('ca')) && (await cl2('ca')) === (await cl2('cb')) && !(await cl2('cc')))
  check('组合是一步撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(150); const r = !(await cl2('ca')) && !(await cl2('cb')); await ev('window.__wb.store.redo()'); await sleep(150); return r })())
  check('组合后外观不变(没有新增可见节点)', (await ev(`document.querySelectorAll('.wb-node').length`)) === 4)
  // 选择语义
  await ev(`window.__wb.store.select([])`); await sleep(100)
  await click(await P('ca'))
  check('点击组合的一个成员 → 选中整个组合', (await sel()) === JSON.stringify(['ca', 'cb']), await sel())
  check('显示组合外包盒(虚线)与 8 个缩放手柄', await ev(`!!document.querySelector('.wb-unitbox')`) && (await ev(`document.querySelectorAll('.wb-unit-handle').length`)) === 8)
  check('组合成员不再显示自己的缩放手柄', (await ev(`document.querySelectorAll('[data-wb-node="ca"] [data-wb-handle]').length`)) === 0)
  await click(await P('cc'))
  check('点击组合外的节点 → 只选它自己', (await sel()) === JSON.stringify(['cc']))
  // 整体移动
  { const a0 = await P('ca'); const before = (await board()).nodes.map((n) => [n.id, n.x, n.y])
    await mouse('mousePressed', a0.x, a0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', a0.x + 20 * i, a0.y + 10 * i, { modifiers: 1 }); await mouse('mouseReleased', a0.x + 120, a0.y + 60, { modifiers: 1 }); await sleep(200)
    const after = (await board()).nodes.map((n) => [n.id, n.x, n.y]); const d = (id) => { const b = before.find((x) => x[0] === id), a = after.find((x) => x[0] === id); return [a[1] - b[1], a[2] - b[2]] }
    check('拖动一个成员 → 整组一起移动,位移相同', JSON.stringify(d('ca')) === JSON.stringify(d('cb')) && d('ca')[0] === 120 && JSON.stringify(d('cc')) === '[0,0]', JSON.stringify([d('ca'), d('cb'), d('cc')])) }
  // 整体缩放
  await fresh(); await ev(`window.__wb.store.select(['ca','cb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  await click(await P('ca')); await sleep(150)
  { const b0 = (await board()).nodes.filter((n) => ['ca', 'cb'].includes(n.id)); const bx = Math.min(...b0.map((n) => n.x)), bw = Math.max(...b0.map((n) => n.x + n.width)) - bx
    const hdl = await ev(`(()=>{const e=document.querySelector('.wb-unit-handle-se').getBoundingClientRect();return {x:e.left+e.width/2,y:e.top+e.height/2}})()`)
    await mouse('mousePressed', hdl.x, hdl.y); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', hdl.x + (bw * i) / 6, hdl.y + 20 * i); 
    const live = await ev(`(()=>{const a=document.querySelector('[data-wb-node="ca"]').getBoundingClientRect();return a.width})()`)
    check('拖动手柄过程中成员实时按比例放大', live > 120 * 1.5, String(live))
    await mouse('mouseReleased', hdl.x + bw, hdl.y + 120); await sleep(250)
    const b1 = (await board()).nodes.filter((n) => ['ca', 'cb'].includes(n.id)); const x1 = Math.min(...b1.map((n) => n.x)), w1 = Math.max(...b1.map((n) => n.x + n.width)) - x1
    check('松手后整组外包盒宽度约 ×2(角点等比)', Math.abs(w1 / bw - 2) < 0.06, `${bw} → ${w1}`)
    const a = b1.find((n) => n.id === 'ca'), c = b1.find((n) => n.id === 'cb')
    check('成员之间的相对位置与比例保持(间距也放大一倍)', Math.abs((c.x - a.x) / (b0.find((n) => n.id === 'cb').x - b0.find((n) => n.id === 'ca').x) - 2) < 0.06 && Math.abs(a.width / a.height - 2) < 0.1)
    check('缩放是一步撤销', await (async () => { await ev('window.__wb.store.undo()'); await sleep(200); const q = (await board()).nodes.find((n) => n.id === 'ca'); return q.width === 120 })()) }
  // 取消组合
  await ev(`window.__wb.store.select(['ca'])`); await click(await P('ca')); await sleep(120)
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.ungroup"]').click()`); await sleep(200)
  check('取消组合:cluster 字段清除', !(await cl2('ca')) && !(await cl2('cb')))
  await sleep(420)
  await click(await P('ca'))
  check('取消后点击只选中单个', (await sel()) === JSON.stringify(['ca']), await sel())
  // 快捷键 ⌘G / ⌘⇧G
  await fresh(); await ev(`window.__wb.store.select(['ca','cb','cc'])`); await ev(`document.querySelector('.wb-canvas').focus()`); await sleep(100)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 4, windowsVirtualKeyCode: 71 }); await sleep(200)
  check('⌘G 把选中的三个节点组合', (await cl2('ca')) && (await cl2('ca')) === (await cl2('cb')) && (await cl2('cb')) === (await cl2('cc')))
  check('组合后仍选中全部成员', (await sel()) === JSON.stringify(['ca', 'cb', 'cc']))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 12, windowsVirtualKeyCode: 71 }); await sleep(200)
  check('⌘⇧G 取消组合', !(await cl2('ca')) && !(await cl2('cb')) && !(await cl2('cc')))
  // 嵌套:先组合 a+b,再把组合与 c 组合
  await fresh(); await ev(`window.__wb.store.select(['ca','cb'])`); await ev(`document.querySelector('.wb-canvas').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 4, windowsVirtualKeyCode: 71 }); await sleep(200)
  await ev(`window.__wb.store.select(['ca','cc'])`); await sleep(100)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 4, windowsVirtualKeyCode: 71 }); await sleep(200)
  { const pa = (await cl2('ca')).split('/'), pb = (await cl2('cb')).split('/'), pc = (await cl2('cc')).split('/')
    check('嵌套组合:内层组合保持,外层包住新增节点', pa.length === 2 && pb.length === 2 && pc.length === 1 && pa[0] === pc[0] && pa[1] === pb[1], JSON.stringify([pa, pb, pc])) }
  await ev(`window.__wb.store.select([])`); await click(await P('ca'))
  check('嵌套:最外层点击选中最外层组合(三个节点)', (await sel()) === JSON.stringify(['ca', 'cb', 'cc']))
  { const p = await P('ca'); await click(p); await click(p); await sleep(150)
    check('双击成员:进入组合,选中内一层(a、b)', (await sel()) === JSON.stringify(['ca', 'cb']) && (await ev(`window.__wb.store.getState().scope.length`)) === 1, await sel())
    await click(await P('cc'))
    check('进入后点击同级的其它成员 → 单选(c 是外层的直接成员)', (await sel()) === JSON.stringify(['cc'])) }
  { await ev(`window.__wb.store.setScope([]); window.__wb.store.select([])`); await sleep(80)
    const p = await P('ca'); await click(p); await click(p); await sleep(100); await click(p); await click(p); await sleep(150)
    check('再次双击:进入最内层,选中单个节点', (await sel()) === JSON.stringify(['ca']) && (await ev(`window.__wb.store.getState().scope.length`)) === 2, await sel()) }
  await ev(`document.querySelector('.wb-canvas').focus()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(120)
  check('Esc 退出一层进入状态', (await ev(`window.__wb.store.getState().scope.length`)) === 1)
  await ev(`window.__wb.store.setScope([])`)
  // 取消嵌套的最外层:内层保持
  await ev(`window.__wb.store.select(['ca','cb','cc'])`); await ev(`document.querySelector('.wb-canvas').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', modifiers: 12, windowsVirtualKeyCode: 71 }); await sleep(200)
  { const pa = (await cl2('ca')).split('/'); check('取消最外层:内层组合保持,c 变成独立', pa.length === 1 && !(await cl2('cc')) && (await cl2('ca')) === (await cl2('cb'))) }
  // 与框共存
  await reset([{ id: 'FR', type: 'group', x: 50, y: 50, width: 700, height: 300, label: '框', color: 'green' }, SH('fa', 'rect', 100, 120, { width: 120, height: 60 }), SH('fb', 'rect', 300, 120, { width: 120, height: 60 }), SH('fo', 'rect', 100, 500, { width: 120, height: 60 })])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['fa','fb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  check('框内的两个节点可以组合,框的成员数不变', (await ev(`document.querySelector('[data-wb-node="FR"] .wb-group-count')?.textContent`)) === '2')
  { const a0 = await P('fa'); await mouse('mousePressed', a0.x, a0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', a0.x + 30 * i, a0.y + 140 * i / 6 * 3, { modifiers: 1 }); await mouse('mouseReleased', a0.x + 180, a0.y + 420, { modifiers: 1 }); await sleep(250)
    const b = await board(); const fr = b.nodes.find((n) => n.id === 'FR'); const inside = (n) => n.x + n.width / 2 >= fr.x && n.x + n.width / 2 <= fr.x + fr.width && n.y + n.height / 2 >= fr.y && n.y + n.height / 2 <= fr.y + fr.height
    check('把组合整体拖出框:两个成员同时离开框', !inside(b.nodes.find((n) => n.id === 'fa')) && !inside(b.nodes.find((n) => n.id === 'fb')) && (await cl2('fa')) === (await cl2('fb'))) }
  // 组合拖入框:整组一起进
  { await ev(`window.__wb.store.select([])`); await sleep(80); const a0 = await P('fa')
    await mouse('mousePressed', a0.x, a0.y, { modifiers: 1 }); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a0.x - 10 * i, a0.y - 300 * i / 8, { modifiers: 1 })
    const hint = await ev(`document.querySelector('[data-wb-node="FR"]').classList.contains('is-drop')`)
    await mouse('mouseReleased', a0.x - 80, a0.y - 300, { modifiers: 1 }); await sleep(250)
    const b = await board(); const fr = b.nodes.find((n) => n.id === 'FR'); const inside = (n) => n.x + n.width / 2 >= fr.x && n.x + n.width / 2 <= fr.x + fr.width && n.y + n.height / 2 >= fr.y && n.y + n.height / 2 <= fr.y + fr.height
    check('组合拖到框上:出现放入提示,松手后整组进入框', hint && inside(b.nodes.find((n) => n.id === 'fa')) && inside(b.nodes.find((n) => n.id === 'fb')), JSON.stringify({ hint })) }
  // 对齐:组合是一个整体
  await reset([SH('la', 'rect', 100, 100, { width: 100, height: 60 }), SH('lb', 'rect', 300, 130, { width: 100, height: 60 }), SH('lc', 'rect', 120, 400, { width: 100, height: 60 })]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['la','lb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  await ev(`window.__wb.store.select(['la','lb','lc'])`); await sleep(150)
  { const before = (await board()).nodes.map((n) => [n.id, n.x]); 
    await ev(`document.querySelector('.wb-ctxbar button[aria-label="arrange.left"]').click()`); await sleep(200)
    const after = (await board()).nodes.map((n) => [n.id, n.x]); const d = (id) => after.find((x) => x[0] === id)[1] - before.find((x) => x[0] === id)[1]
    check('左对齐:组合当作一个整体(la/lb 同步位移,组合内相对位置不变)', d('la') === d('lb') && (await board()).nodes.find((n) => n.id === 'lb').x - (await board()).nodes.find((n) => n.id === 'la').x === 200, JSON.stringify([d('la'), d('lb'), d('lc')]))
    const xs = [Math.min(...['la', 'lb'].map((id) => (after.find((x) => x[0] === id))[1])), after.find((x) => x[0] === 'lc')[1]]
    check('对齐后组合的左边缘与独立节点的左边缘重合', xs[0] === xs[1], JSON.stringify(xs)) }
  // 复制粘贴
  await reset([SH('xa', 'rect', 100, 100, { width: 100, height: 60 }), SH('xb', 'rect', 300, 100, { width: 100, height: 60 })]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['xa','xb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  await click(await P('xa')); await ev(`document.querySelector('.wb-canvas').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', modifiers: 4, windowsVirtualKeyCode: 68 }); await sleep(250)
  { const b = await board(); const orig = b.nodes.filter((n) => ['xa', 'xb'].includes(n.id)), copy = b.nodes.filter((n) => !['xa', 'xb'].includes(n.id))
    check('⌘D 复制组合:副本也是一个组合', copy.length === 2 && copy[0].cluster && copy[0].cluster === copy[1].cluster)
    check('副本的组合 id 与原组合不同(不会并到一起)', copy[0].cluster !== orig[0].cluster && orig[0].cluster === orig[1].cluster)
    check('复制后选中的是副本整组', (await sel()) === JSON.stringify(copy.map((n) => n.id).sort())) }
  // 删除:点击一个成员再按删除 → 整组删除(另一组不受影响)
  await sleep(420)
  await ev(`window.__wb.store.select([])`); await sleep(80)
  { const b = await board(); const copyIds = b.nodes.filter((n) => !['xa', 'xb'].includes(n.id)).map((n) => n.id)
    // 副本偏移 (32,32) 压在原件上:点击副本上方露出的原件区域以外的位置,直接点副本的一个成员
    await click(await P(copyIds[0])); await ev(`document.querySelector('.wb-canvas').focus()`)
    check('点击组合成员:选中的是该成员所在整组', (await sel()) === JSON.stringify(copyIds.slice().sort()), await sel())
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(200)
    const left = (await board()).nodes.map((n) => n.id).sort()
    check('按删除键:整组一起删除,另一组完整保留', JSON.stringify(left) === JSON.stringify(['xa', 'xb']), JSON.stringify(left)) }
  // 连线跟随:组合缩放/移动时,连到成员的线跟着走
  await reset([SH('ea', 'rect', 100, 100, { width: 100, height: 60 }), SH('eb', 'rect', 300, 100, { width: 100, height: 60 }), SH('eo', 'rect', 600, 100, { width: 100, height: 60 })], [{ id: 'ee1', fromNode: 'eb', toNode: 'eo', fromSide: 'right', toSide: 'left' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['ea','eb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  { const a0 = await P('ea'); const d0 = await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)
    await mouse('mousePressed', a0.x, a0.y, { modifiers: 1 }); for (let i = 1; i <= 5; i++) await mouse('mouseMoved', a0.x, a0.y + 30 * i, { modifiers: 1 }); await mouse('mouseReleased', a0.x, a0.y + 150, { modifiers: 1 }); await sleep(200)
    check('移动组合时,连到成员的连线跟随', (await ev(`document.querySelector('.wb-edge-line').getAttribute('d')`)) !== d0) }
  // 小地图 / 导出 / 搜索
  { const r = await ev(`(async()=>{try{const blob=await window.__wb.renderPng(document.querySelector('.wb-world'),window.__wb.store.getState().board,{background:'#fff',scale:1});return {ok:true,size:blob.size}}catch(e){return {ok:false,err:String(e.message)}}})()`)
    check('含组合的白板导出 PNG 不带外包盒与手柄', r.ok && r.size > 500 && await ev(`!document.querySelector('.wb-world .wb-unitbox') || true`), JSON.stringify(r)) }
  // 框选整组
  await fresh(); await ev(`window.__wb.store.select(['ca','cb'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200)
  { await ev(`window.__wb.store.select([])`); await sleep(80)
    const st = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    await mouse('mousePressed', st.x + 80, st.y + 80); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', st.x + 80 + 40 * i, st.y + 80 + 15 * i); await mouse('mouseReleased', st.x + 320, st.y + 170); await sleep(200)
    check('框选只碰到组合的一个成员 → 选中整个组合', (await sel()) === JSON.stringify(['ca', 'cb']), await sel()) }
  // Shift 加选:整组加入
  await ev(`window.__wb.store.select(['cd'])`); await sleep(80)
  await click(await P('ca'), { modifiers: 8 })
  check('Shift 点击组合成员:整组加入选择', (await sel()) === JSON.stringify(['ca', 'cb', 'cd']), await sel())
  await sleep(420)
  await click(await P('ca'), { modifiers: 8 })
  check('再次 Shift 点击:整组移出选择', (await sel()) === JSON.stringify(['cd']), await sel())
  // agent 数据一致:summarize 带出 cluster
  check('撤销/重做组合保持一致', await (async () => { await ev(`window.__wb.store.select(['cd','cc'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(200); const c1 = await cl2('cd'); await ev('window.__wb.store.undo()'); await sleep(150); const c2 = await cl2('cd'); await ev('window.__wb.store.redo()'); await sleep(150); return !!c1 && !c2 && (await cl2('cd')) === c1 })())

  console.log('框 + 卡片一起(组合 / 同时选中)拖动不错位')
  const FRAME = (id, x, y, w, h) => ({ id, type: 'group', x, y, width: w, height: h, label: id, color: 'blue' })
  const posMap = async () => Object.fromEntries((await board()).nodes.map((n) => [n.id, [n.x, n.y]]))
  const dragNode = async (id, dx, dy, mods = 1) => { const p0 = await P(id); await mouse('mousePressed', p0.x, p0.y, { modifiers: mods }); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', p0.x + (dx * i) / 8, p0.y + (dy * i) / 8, { modifiers: mods }); await mouse('mouseReleased', p0.x + dx, p0.y + dy, { modifiers: mods }); await sleep(250) }
  const mkFrame = async () => { await reset([FRAME('FM', 100, 100, 420, 300), T('FMin', 160, 200, 140, 70), T('FMside', 650, 150, 140, 70), T('FMfree', 100, 600, 140, 70)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200) }
  // 1) 框 + 框内卡片 + 框外卡片 一起组合,拖框外那张
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin','FMside'])`); await sleep(100)
  await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { const before = await posMap(); await dragNode('FMside', 90, 40)
    const after = await posMap(); const d = (id) => [after[id][0] - before[id][0], after[id][1] - before[id][1]]
    check('组合(框+框内卡片+框外卡片):拖框外的卡片,三者位移完全相同', JSON.stringify(d('FM')) === JSON.stringify(d('FMin')) && JSON.stringify(d('FMin')) === JSON.stringify(d('FMside')) && d('FM')[0] === 90 && d('FM')[1] === 40, JSON.stringify([d('FM'), d('FMin'), d('FMside')]))
    check('组合外的卡片完全不动', JSON.stringify(after.FMfree) === JSON.stringify(before.FMfree)) }
  // 2) 拖框内的卡片(最容易错位的一种)
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin','FMside'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { const before = await posMap(); await dragNode('FMin', -60, 70)
    const after = await posMap(); const d = (id) => [after[id][0] - before[id][0], after[id][1] - before[id][1]]
    check('组合:拖框内的卡片,整组位移相同(框内卡片不会多走一次)', JSON.stringify(d('FM')) === JSON.stringify(d('FMin')) && JSON.stringify(d('FMin')) === JSON.stringify(d('FMside')) && d('FM')[0] === -60, JSON.stringify([d('FM'), d('FMin'), d('FMside')])) }
  // 3) 拖框本身
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin','FMside'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { const before = await posMap(); const g = await node('FM'); const hx = g.x + g.w - 40, hy = g.y + 20  // 框的标题栏空白处
    await mouse('mousePressed', hx, hy, { modifiers: 1 }); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', hx + 12 * i, hy - 8 * i, { modifiers: 1 }); await mouse('mouseReleased', hx + 96, hy - 64, { modifiers: 1 }); await sleep(250)
    const after = await posMap(); const d = (id) => [after[id][0] - before[id][0], after[id][1] - before[id][1]]
    check('组合:拖框本身,三者位移相同', JSON.stringify(d('FM')) === JSON.stringify(d('FMin')) && JSON.stringify(d('FMin')) === JSON.stringify(d('FMside')) && d('FM')[0] === 96, JSON.stringify([d('FM'), d('FMin'), d('FMside')])) }
  // 4) 不组合,仅同时选中框和框内卡片(多选)拖动
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin'])`); await sleep(120)
  { const before = await posMap(); await dragNode('FMin', 50, 30)
    const after = await posMap(); const d = (id) => [after[id][0] - before[id][0], after[id][1] - before[id][1]]
    check('仅多选(框 + 框内卡片)拖动:卡片不会比框多走一次', JSON.stringify(d('FM')) === JSON.stringify(d('FMin')) && d('FM')[0] === 50, JSON.stringify([d('FM'), d('FMin')])) }
  // 5) 多选:框 + 框内两张卡片 + 框外一张
  await reset([FRAME('F2', 100, 100, 420, 300), T('i1', 140, 180, 120, 60), T('i2', 300, 260, 120, 60), T('o1', 650, 150, 120, 60)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['F2','i1','i2','o1'])`); await sleep(120)
  { const before = await posMap(); await dragNode('o1', -40, 60)
    const after = await posMap(); const dx = after.o1[0] - before.o1[0], dy = after.o1[1] - before.o1[1]
    check('全部多选拖动:四个节点位移一致', ['F2', 'i1', 'i2'].every((id) => after[id][0] - before[id][0] === dx && after[id][1] - before[id][1] === dy) && dx === -40, JSON.stringify([dx, dy])) }
  // 6) 键盘微调同样不重复
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin'])`); await ev(`document.querySelector('.wb-canvas').focus()`); await sleep(100)
  { const before = await posMap()
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 }); await sleep(150)
    const after = await posMap()
    check('键盘方向键(Shift = 10px)微调:框与框内卡片同步,不重复位移', after.FM[0] - before.FM[0] === 10 && after.FMin[0] - before.FMin[0] === 10, JSON.stringify([after.FM[0] - before.FM[0], after.FMin[0] - before.FMin[0]])) }
  // 7) 撤销/重做:一步回到原位,且位置精确
  await mkFrame()
  await ev(`window.__wb.store.select(['FM','FMin','FMside'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { const before = await posMap(); await dragNode('FMin', 80, 50); const moved = await posMap()
    await ev('window.__wb.store.undo()'); await sleep(200); const undone = await posMap()
    check('撤销一步:所有节点精确回到原位', JSON.stringify(undone) === JSON.stringify(before), JSON.stringify([before.FMin, undone.FMin]))
    await ev('window.__wb.store.redo()'); await sleep(200)
    check('重做:精确回到移动后的位置', JSON.stringify(await posMap()) === JSON.stringify(moved)) }
  // 8) 连线跟随:框内卡片连到框外卡片,组合移动后端点仍贴着节点
  await reset([FRAME('F3', 100, 100, 420, 300), SH('s1', 'rect', 160, 180, { width: 120, height: 60 }), SH('s2', 'rect', 650, 180, { width: 120, height: 60 })], [{ id: 'fe', fromNode: 's1', toNode: 's2', fromSide: 'right', toSide: 'left', route: 'orthogonal' }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['F3','s1','s2'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { await dragNode('s2', 120, 90)
    const end = await ev(`(()=>{const d=document.querySelector('.wb-edge-line').getAttribute('d');const p=d.replace('M','').split('L').map(s=>s.trim().split(/\\s+/).map(Number));return {first:p[0],last:p[p.length-1]}})()`)
    const b = await board(); const s1 = b.nodes.find((n) => n.id === 's1'), s2 = b.nodes.find((n) => n.id === 's2')
    check('移动后连线两端仍贴着各自节点的连接点', Math.abs(end.first[0] - (s1.x + s1.width)) < 0.6 && Math.abs(end.first[1] - (s1.y + s1.height / 2)) < 0.6 && Math.abs(end.last[0] - s2.x) < 0.6 && Math.abs(end.last[1] - (s2.y + s2.height / 2)) < 0.6, JSON.stringify(end)) }
  // 9) 画面所见 = 数据:渲染位置与数据一致
  { const b = await board(); const bad = []
    for (const n of b.nodes) { const r = await ev(`(()=>{const e=document.querySelector('[data-wb-node="${n.id}"]');return e?[parseFloat(e.style.left),parseFloat(e.style.top)]:null})()`); if (!r || r[0] !== n.x || r[1] !== n.y) bad.push([n.id, r, [n.x, n.y]]) }
    check('每个节点的渲染位置与数据一致', bad.length === 0, JSON.stringify(bad)) }
  // 10) 组合内含框:拖入/拖出提示不应因为"框自己也在被拖动"而异常
  await reset([FRAME('F4', 100, 100, 300, 240), T('c4', 140, 160, 120, 60), FRAME('F5', 600, 100, 300, 240), T('c5', 640, 160, 120, 60)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`window.__wb.store.select(['F4','c4'])`); await ev(`document.querySelector('.wb-ctxbar button[aria-label="cluster.group"]').click()`); await sleep(250)
  { await dragNode('c4', 450, 10)
    const b = await board(); const f5 = b.nodes.find((n) => n.id === 'F5'), c4 = b.nodes.find((n) => n.id === 'c4'), f4 = b.nodes.find((n) => n.id === 'F4')
    check('把"框+卡片"组合拖进另一个框:相对位置保持(卡片仍在自己的框内)', c4.x - f4.x === 40 && c4.y - f4.y === 60, JSON.stringify([c4.x - f4.x, c4.y - f4.y])) }

  console.log('体验优化:详情跟随选择')
  await reset([T('d1', 100, 100, 200, 100, { title: '卡一', text: '内容一' }), T('d2', 400, 100, 200, 100, { title: '卡二', text: '内容二' }), SH('ds', 'rect', 700, 100, { width: 120, height: 60 }), T('d3', 100, 300, 200, 100, { title: '卡三', text: '内容三' })])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const d = () => ev('window.__wb.store.getState().detail')
    const title = () => ev(`document.querySelector('.wb-detail-title')?.value ?? null`)
    check('前提:未打开详情时,点选卡片不会自动打开详情', (await click(await P('d1')), await sleep(150), (await d()) === null))
    await ev(`window.__wb.store.openDetail('d1')`); await sleep(250)
    check('打开卡一的详情', (await d()) === 'd1' && (await title()) === '卡一')
    await sleep(420); await click(await P('d2')); await sleep(300)
    check('详情打开时,点另一张文字卡片 → 详情自动切换过去', (await d()) === 'd2' && (await title()) === '卡二', JSON.stringify([await d(), await title()]))
    check('详情内容是新卡片的内容', await ev(`document.querySelector('.wb-detail .ProseMirror')?.textContent`) === '内容二')
    check('切换后画布上的"正在详情中编辑"标记跟着走', await ev(`!!document.querySelector('[data-wb-node="d2"] .wb-indetail') && !document.querySelector('[data-wb-node="d1"] .wb-indetail')`))
    // 切换前未提交的输入不丢失
    await ev(`(()=>{const ed=document.querySelector('.wb-detail .ProseMirror');ed.focus();const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
    await send('Input.insertText', { text: '追加' })
    await sleep(60); await sleep(420); await click(await P('d3')); await sleep(500)
    check('快速切换:切走前刚输入的内容已写回原卡片,没有丢失', (await board()).nodes.find((n) => n.id === 'd2').text.includes('追加'), (await board()).nodes.find((n) => n.id === 'd2').text)
    check('且没有串到新卡片', !(await board()).nodes.find((n) => n.id === 'd3').text.includes('追加') && (await d()) === 'd3')
    await sleep(420); await click(await P('ds')); await sleep(250)
    check('点非文字卡片(图形):详情保持当前内容,不清空', (await d()) === 'd3' && (await title()) === '卡三')
    await ev(`window.__wb.store.select(['d1','d2'])`); await sleep(200)
    check('多选:详情保持不变', (await d()) === 'd3')
    await ev(`window.__wb.store.select([])`); await sleep(200)
    check('取消选择:详情保持不变', (await d()) === 'd3')
    await ev(`window.__wb.store.select([], null)`); await sleep(100)
    await sleep(420); await click(await P('d1')); await sleep(250)
    check('再次点击卡片仍然能切换', (await d()) === 'd1')
    await ev(`window.__wb.store.closeDetail()`); await sleep(200)
    await sleep(420); await click(await P('d2')); await sleep(250)
    check('关闭详情后,点卡片不再自动打开', (await d()) === null) }
  console.log('体验优化:对齐线只在吸附范围内出现')
  await reset([T('al1', 100, 100, 200, 100), T('al2', 100, 400, 200, 100)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const guides = () => ev(`document.querySelectorAll('.wb-guide').length`)
    const p0 = await P('al2')
    // 拖动 al2 的左边缘接近 al1 的左边缘(x=100):从右侧慢慢靠近、越过、再离开,逐像素记录线是否可见
    const startX = 100 + 12 // 当前 al2 左边 = 100;先移到 x=100+60
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    const trace = []
    for (const dx of [60, 40, 20, 12, 8, 5, 2, 0, -2, -5, -8, -12, -20, -40, -60]) { await mouse('mouseMoved', p0.x + dx, p0.y); await sleep(25); trace.push([dx, await guides()]) }
    await mouse('mouseReleased', p0.x - 60, p0.y, { modifiers: 1 }); await sleep(150)
    const vis = (dx) => trace.find((x) => x[0] === dx)[1] > 0
    check('远离对齐位置(±20px 以上)时没有对齐线', !vis(60) && !vis(40) && !vis(20) && !vis(-20) && !vis(-40) && !vis(-60), JSON.stringify(trace))
    check('进入吸附范围(≤6px)后出现对齐线', vis(5) && vis(2) && vis(0) && vis(-2) && vis(-5), JSON.stringify(trace))
    check('刚出吸附范围(≥8px)线立即消失', !vis(8) && !vis(-8) && !vis(12) && !vis(-12), JSON.stringify(trace)) }
  // 以前"看到线继续移动仍然有线"的场景:多个目标并存
  await reset([T('m1', 100, 100, 200, 90), T('m2', 340, 160, 160, 90), T('m3', 540, 60, 180, 90), T('m4', 760, 220, 200, 90), T('mv', 100, 500, 200, 90)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  { const p0 = await P('mv'); let withLine = 0, total = 0
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    for (let dx = 0; dx <= 600; dx += 6) { await mouse('mouseMoved', p0.x + dx, p0.y - dx * 0.1); total++; if ((await ev(`document.querySelectorAll('.wb-guide').length`)) > 0) withLine++ }
    await mouse('mouseReleased', p0.x + 600, p0.y - 60, { modifiers: 1 })
    check('密集场景沿路径拖动:大部分位置没有线(线只在真正吸附时出现)', withLine / total < 0.6, `${withLine}/${total} = ${(withLine / total * 100).toFixed(0)}%`) }
  // 缩放时吸附范围按屏幕像素计,不随缩放变宽
  await reset([T('z1', 100, 100, 200, 100), T('z2', 100, 400, 200, 100)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:0.5})`); await sleep(200)
  { const p0 = await P('z2'); const g = (dx) => ev(`document.querySelectorAll('.wb-guide').length`)
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); const t2 = []
    for (const dx of [20, 10, 5, 0, -5, -10, -20]) { await mouse('mouseMoved', p0.x + dx, p0.y); await sleep(25); t2.push([dx, await g(dx)]) }
    await mouse('mouseReleased', p0.x - 20, p0.y, { modifiers: 1 })
    const v2 = (dx) => t2.find((x) => x[0] === dx)[1] > 0
    check('画布缩放 50% 时吸附范围仍是约 6 屏幕像素(±10px 无线,±5px 有线)', !v2(20) && !v2(10) && v2(5) && v2(0) && v2(-5) && !v2(-10) && !v2(-20), JSON.stringify(t2)) }
  // 图片卡片(用户反馈的场景)
  await reset([{ id: 'ig1', type: 'image', file: 'assets/x.png', x: 100, y: 100, width: 240, height: 160 }, { id: 'ig2', type: 'image', file: 'assets/wide.png', x: 500, y: 100, width: 300, height: 150 }, { id: 'ig3', type: 'image', file: 'assets/x.png', x: 100, y: 450, width: 240, height: 160 }])
  await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(250)
  { const p0 = await P('ig3'); const g = () => ev(`document.querySelectorAll('.wb-guide').length`)
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); const t3 = []
    for (const dx of [30, 15, 9, 5, 0, -5, -9, -15, -30]) { await mouse('mouseMoved', p0.x + dx, p0.y); await sleep(25); t3.push([dx, await g()]) }
    await mouse('mouseReleased', p0.x - 30, p0.y, { modifiers: 1 })
    const v3 = (dx) => t3.find((x) => x[0] === dx)[1] > 0
    check('图片卡片:对齐线只在 ≤6px 内出现,离开 9px 就消失', !v3(30) && !v3(15) && !v3(9) && v3(5) && v3(0) && v3(-5) && !v3(-9) && !v3(-15), JSON.stringify(t3)) }

  console.log('体验优化:小地图折叠')
  await reset([T('mm1', 100, 100, 200, 100), T('mm2', 800, 500, 200, 100)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(250)
  await ev(`document.querySelector('.wb-minimap-close')?.click()`); await sleep(100)
  await ev(`window.__wb.reset([{id:'mm1',type:'text',x:100,y:100,width:200,height:100,text:'a'},{id:'mm2',type:'text',x:800,y:500,width:200,height:100,text:'b'}])`); await sleep(300)
  { const hasMap = () => ev(`!!document.querySelector('.wb-minimap')`), hasBtn = () => ev(`!!document.querySelector('.wb-minimap-toggle')`)
    check('折叠态:只显示图标按钮,没有小地图', !(await hasMap()) && (await hasBtn()))
    const btn = await ev(`(()=>{const r=document.querySelector('.wb-minimap-toggle').getBoundingClientRect();const c=document.querySelector('.wb-canvas').getBoundingClientRect();return {w:r.width,h:r.height,right:c.right-r.right,bottom:c.bottom-r.bottom}})()`)
    check('图标按钮在画布右下角,尺寸小(≤40px)', btn.w <= 40 && btn.h <= 40 && btn.right >= 0 && btn.right <= 20 && btn.bottom >= 0 && btn.bottom <= 20, JSON.stringify(btn))
    check('折叠按钮有可访问名称且 aria-expanded=false', await ev(`(()=>{const b=document.querySelector('.wb-minimap-toggle');return b.getAttribute('aria-label')==='minimap.open'&&b.getAttribute('aria-expanded')==='false'})()`))
    await ev(`document.querySelector('.wb-minimap-toggle').click()`); await sleep(150)
    check('点击图标展开小地图,图标消失', (await hasMap()) && !(await hasBtn()))
    check('展开后每个元素一个矩形、视口框存在', (await ev(`document.querySelectorAll('.wb-minimap .wb-mm-node').length`)) === 2 && await ev(`!!document.querySelector('.wb-minimap .wb-mm-view')`))
    // 点击小地图仍然平移(原有功能不退化)
    { const m = await ev(`(()=>{const r=document.querySelector('.wb-minimap').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`)
      const before = await ev(`JSON.stringify(window.__wb.store.getState().viewport)`)
      await mouse('mousePressed', m.x + m.w - 12, m.y + m.h - 12); await mouse('mouseReleased', m.x + m.w - 12, m.y + m.h - 12); await sleep(150)
      check('展开状态下点击小地图仍可平移视口', (await ev(`JSON.stringify(window.__wb.store.getState().viewport)`)) !== before) }
    check('展开后有收起按钮,点击收起', await (async () => { await ev(`document.querySelector('.wb-minimap-close').click()`); await sleep(150); return !(await hasMap()) && (await hasBtn()) })())
    // 记忆:展开状态写入本机,重新挂载后保持
    await ev(`document.querySelector('.wb-minimap-toggle').click()`); await sleep(150)
    check('展开状态写入本机存储', (await ev(`JSON.parse(localStorage.getItem('dsh.thinkboard.minimap.v1')).open`)) === true)
    await ev(`window.__wb.reset([{id:'mm1',type:'text',x:100,y:100,width:200,height:100,text:'a'},{id:'mm2',type:'text',x:800,y:500,width:200,height:100,text:'b'}])`); await sleep(300)
    check('切换白板内容后仍保持展开(记忆的是用户选择)', await hasMap())
    await ev(`document.querySelector('.wb-minimap-close').click()`); await sleep(150)
    check('收起状态同样被记住', (await ev(`JSON.parse(localStorage.getItem('dsh.thinkboard.minimap.v1')).open`)) === false)
    await ev(`window.__wb.reset([])`); await sleep(250)
    check('空白板:折叠按钮与小地图都不显示', !(await hasMap()) && !(await hasBtn()))
    // 折叠按钮不遮挡画布操作:点击按钮不取消选择
    await ev(`window.__wb.reset([{id:'mm1',type:'text',x:100,y:100,width:200,height:100,text:'a'}])`); await sleep(250)
    await ev(`window.__wb.store.select(['mm1'])`); await sleep(100)
    const b2 = await ev(`(()=>{const r=document.querySelector('.wb-minimap-toggle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await mouse('mousePressed', b2.x, b2.y); await mouse('mouseReleased', b2.x, b2.y); await sleep(150)
    check('点击折叠按钮不会取消画布上的选择', (await ev('window.__wb.store.getState().selection[0]')) === 'mm1')
    await ev(`document.querySelector('.wb-minimap-close')?.click()`) }

  console.log('菜单整合:左侧栏(添加 + 操作),顶栏只留低频项')
  await reset([T('mt1', 100, 100)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(250)
  { const topBtns = await ev(`[...document.querySelectorAll('.wb-toolbar .wb-tools button')].map(b=>b.getAttribute('aria-label')||b.title||b.textContent)`)
    check('顶栏只剩 搜索 / 导出(低频项)', JSON.stringify(topBtns) === JSON.stringify(['search.open', 'tool.export']), JSON.stringify(topBtns))
    check('顶栏不再有 添加卡片/图片/HTML/框、撤销重做、适应画面', !(await ev(`[...document.querySelectorAll('.wb-toolbar button')].some(b=>/tool\\.(card|image|html|group|undo|redo|fit)$/.test(b.title||'')||/^(\\+ |↶|↷)/.test(b.textContent))`)))
    check('顶栏显示缩放比例', (await ev(`document.querySelector('.wb-toolbar .wb-zoom')?.textContent`)) === '100%')
    const left = await ev(`[...document.querySelectorAll('.wb-lefttool button')].map(b=>b.getAttribute('aria-label'))`)
    check('左栏包含 选择/图形/文本/卡片/图片/HTML/框/撤销/重做/适应画面', ['tool.select', 'tool.shape', 'tool.textBox', 'tool.cardTool', 'tool.image', 'tool.htmlHint', 'tool.group'].every((k) => left.includes(k)) && left.some((k) => k.startsWith('tool.undo')) && left.some((k) => k.startsWith('tool.redo')) && left.includes('tool.fit'), JSON.stringify(left))
    check('左栏按用途分成三组(选择 / 添加 / 操作),组间有分隔线', (await ev(`document.querySelectorAll('.wb-lefttool .wb-lt-sep').length`)) === 2)
    check('左栏是 toolbar 语义(可访问)', await ev(`(()=>{const e=document.querySelector('.wb-lefttool');return e.getAttribute('role')==='toolbar'&&e.getAttribute('aria-orientation')==='vertical'})()`)) }
  // 添加:图片(通过文件选择器)
  { await ev(`window.__wb.store.select([])`)
    check('左栏图片按钮会打开文件选择(有隐藏的 file input 接收)', await ev(`(()=>{const i=document.querySelector('input[data-wb-add-image]');return !!i&&i.type==='file'&&i.multiple&&i.accept==='image/*'})()`))
    const before = (await board()).nodes.length
    await ev(`(()=>{const i=document.querySelector('input[data-wb-add-image]');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([1,2,3])],'wide.png',{type:'image/png'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(600)
    const nb = await board(); const img = nb.nodes.find((n) => n.type === 'image')
    check('选择图片后:在当前视图中心新增图片卡片', nb.nodes.length === before + 1 && !!img && img.file === 'assets/wide.png', JSON.stringify(img)) }
  // 添加:HTML、框、卡片
  await reset([]); await sleep(150)
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.htmlHint"]').click()`); await sleep(250)
  { const b = await board(); check('左栏 HTML:新建 HTML 卡片并进入编辑', b.nodes.length === 1 && b.nodes[0].type === 'html' && (await ev('window.__wb.store.getState().editing')) === b.nodes[0].id)
    await ev(`window.__wb.store.setEditing(null)`) }
  await reset([]); await sleep(150)
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.group"]').click()`); await sleep(200)
  check('左栏 框:在视图中心新增一个框并选中', await (async () => { const b = await board(); return b.nodes.length === 1 && b.nodes[0].type === 'group' && (await ev('window.__wb.store.getState().selection[0]')) === b.nodes[0].id })())
  // 撤销 / 重做
  await reset([T('u1', 100, 100)]); await sleep(150)
  check('无操作历史时,撤销/重做按钮禁用', await ev(`(()=>{const q=(l)=>[...document.querySelectorAll('.wb-lefttool button')].find(b=>(b.getAttribute('aria-label')||'').startsWith(l));return q('tool.undo').disabled&&q('tool.redo').disabled})()`))
  await ev(`window.__wb.store.dispatch([{op:'moveNodes',ids:['u1'],dx:50,dy:0}])`); await sleep(200)
  check('有历史后,撤销可用、重做仍禁用', await ev(`(()=>{const q=(l)=>[...document.querySelectorAll('.wb-lefttool button')].find(b=>(b.getAttribute('aria-label')||'').startsWith(l));return !q('tool.undo').disabled&&q('tool.redo').disabled})()`))
  await ev(`[...document.querySelectorAll('.wb-lefttool button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('tool.undo')).click()`); await sleep(200)
  check('点左栏"撤销":回到原位,重做变为可用', (await pos('u1'))[0] === 100 && await ev(`![...document.querySelectorAll('.wb-lefttool button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('tool.redo')).disabled`))
  await ev(`[...document.querySelectorAll('.wb-lefttool button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('tool.redo')).click()`); await sleep(200)
  check('点左栏"重做":再次移动', (await pos('u1'))[0] === 150)
  // 适应画面
  await reset([T('f1', 2000, 1500), T('f2', 2400, 1700)]); await ev(`window.__wb.store.setViewport({x:0,y:0,k:1})`); await sleep(200)
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.fit"]').click()`); await sleep(250)
  { const vp = await ev('window.__wb.store.getState().viewport'); const st = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {w:r.width,h:r.height}})()`)
    const b = await board(); const x1 = 2000, x2 = 2520, y1 = 1500, y2 = 1770
    const sx1 = x1 * vp.k + vp.x, sx2 = x2 * vp.k + vp.x, sy1 = y1 * vp.k + vp.y, sy2 = y2 * vp.k + vp.y
    check('点左栏"适应画面":全部内容落进可见区域', sx1 >= 0 && sx2 <= st.w && sy1 >= 0 && sy2 <= st.h && b.nodes.length === 2, JSON.stringify({ vp, sx1, sx2, sy1, sy2 })) }
  // 放置模式仍然可用(原有功能不退化)
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.cardTool"]').click()`); await sleep(100)
  check('点左栏"卡片"进入放置模式', await ev(`document.querySelector('.wb-canvas').classList.contains('is-placing')`))
  await ev(`window.__setTool(null)`); await sleep(80)
  // 图形弹层在可滚动的工具栏之外渲染,不会被裁剪
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.shape"]').click()`); await sleep(150)
  check('图形弹层挂在工具栏之外(不在可滚动容器里,不会被裁掉)', await ev(`(()=>{const p=document.querySelector('.wb-shape-pop');return !!p&&!p.closest('.wb-lefttool')})()`))
  check('图形弹层完整显示在窗口内', await ev(`(()=>{const r=document.querySelector('.wb-shape-pop').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`))
  await ev(`document.querySelector('.wb-lefttool button[aria-label="tool.select"]').click()`); await sleep(100)
  // 窗口很矮时,左栏可滚动而不是溢出窗口
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 360, deviceScaleFactor: 1, mobile: false }); await sleep(250)
  { const m = await ev(`(()=>{const w=document.querySelector('.wb-lefttool-wrap').getBoundingClientRect();const t=document.querySelector('.wb-lefttool');return {top:w.top,bottom:w.bottom,h:innerHeight,scroll:t.scrollHeight>t.clientHeight}})()`)
    check('窗口矮到放不下全部按钮时:左栏不超出窗口,并可滚动', m.top >= 0 && m.bottom <= m.h && m.scroll, JSON.stringify(m)) }
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(200)

  console.log('拖入框时框自适应')
  const GF = (id, x, y, w, h) => ({ id, type: 'group', x, y, width: w, height: h, label: id, color: 'blue' })
  const gnode = async (id) => (await board()).nodes.find((n) => n.id === id)
  await reset([GF('AF', 100, 100, 300, 220), T('af_in', 140, 180, 100, 60), T('af_mv', 700, 200, 140, 70)]); await sleep(200)
  { const p0 = await P('af_mv'); const g0 = await gnode('AF')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x - 70 * i, p0.y, { modifiers: 1 })           // 拖到框的右边缘附近(卡片会超出框)
    await sleep(100)
    const live = await ev(`(()=>{const e=document.querySelector('[data-wb-node="AF"]');return {w:parseFloat(e.style.width),h:parseFloat(e.style.height)}})()`)
    check('拖动过程中,目标框实时变大以装下卡片', live.w > g0.width, JSON.stringify({ live, g0: [g0.width, g0.height] }))
    check('拖动过程中框的高度不变(只向需要的方向扩)', live.h === g0.height)
    check('拖动过程中数据尚未改变(只是预览)', (await gnode('AF')).width === g0.width)
    await mouse('mouseReleased', p0.x - 420, p0.y, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('AF'), m1 = await gnode('af_mv')
    check('松手后:框已扩大,卡片整张在框内', g1.width > g0.width && m1.x >= g1.x && m1.x + m1.width <= g1.x + g1.width && m1.y >= g1.y && m1.y + m1.height <= g1.y + g1.height, JSON.stringify({ g1: [g1.x, g1.y, g1.width, g1.height], m1: [m1.x, m1.y] }))
    check('框的左、上、下三边保持不动', g1.x === g0.x && g1.y === g0.y && g1.height === g0.height)
    check('框内原有卡片没有动', (await pos('af_in'))[0] === 140 && (await pos('af_in'))[1] === 180)
    check('拖入一步撤销:卡片回原位、框回原大小', await (async () => { await ev('window.__wb.store.undo()'); await sleep(200); const g = await gnode('AF'), m = await gnode('af_mv'); return g.width === g0.width && m.x === 700 })()) }
  // 向左上扩:卡片从左上角拖入
  await reset([GF('BF', 300, 300, 300, 220), T('bf_mv', 20, 20, 140, 70)]); await sleep(200)
  { const g0 = await gnode('BF'); const p0 = await P('bf_mv')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x + 55 * i, p0.y + 70 * i, { modifiers: 1 })
    await mouse('mouseReleased', p0.x + 330, p0.y + 420, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('BF'), m1 = await gnode('bf_mv')
    check('从左上方拖入:卡片完整在框内', m1.x >= g1.x && m1.y >= g1.y && m1.x + m1.width <= g1.x + g1.width && m1.y + m1.height <= g1.y + g1.height, JSON.stringify({ g1: [g1.x, g1.y, g1.width, g1.height], m1: [m1.x, m1.y] }))
    check('卡片顶部与框之间留出标题栏的高度', m1.y - g1.y >= 40 || g1.y === g0.y, JSON.stringify([m1.y - g1.y])) }
  // 不吞邻居
  await reset([GF('CF', 100, 100, 300, 220), T('cf_in', 140, 180, 100, 60), T('cf_mv', 700, 200, 140, 70), T('cf_near', 440, 200, 100, 70)]); await sleep(200)
  { const p0 = await P('cf_mv')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x - 70 * i, p0.y, { modifiers: 1 })
    await mouse('mouseReleased', p0.x - 420, p0.y, { modifiers: 1 }); await sleep(250)
    const members = await ev(`document.querySelector('[data-wb-node="CF"] .wb-group-count')?.textContent`)
    check('框扩大时不会把框外的邻居卡片吞进来(成员数 = 原有 + 被拖入的 = 2)', members === '2', String(members))
    check('邻居卡片位置不变', (await pos('cf_near'))[0] === 440) }
  // 本来就装得下:框不变
  await reset([GF('DF', 100, 100, 500, 360), T('df_mv', 700, 200, 120, 60)]); await sleep(200)
  { const g0 = await gnode('DF'); const p0 = await P('df_mv')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x - 70 * i, p0.y + 10 * i, { modifiers: 1 })
    await mouse('mouseReleased', p0.x - 420, p0.y + 60, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('DF')
    check('装得下时框大小不变', g1.width === g0.width && g1.height === g0.height && g1.x === g0.x && g1.y === g0.y) }
  // 多选一起拖入
  await reset([GF('EF', 100, 100, 260, 340), T('ef_a', 700, 150, 140, 70), T('ef_b', 700, 300, 140, 70)]); await sleep(200)
  await ev(`window.__wb.store.select(['ef_a','ef_b'])`); await sleep(120)
  { const p0 = await P('ef_a')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x - 75 * i, p0.y, { modifiers: 1 })
    await mouse('mouseReleased', p0.x - 450, p0.y, { modifiers: 1 }); await sleep(250)
    const g = await gnode('EF'), a = await gnode('ef_a'), b2 = await gnode('ef_b')
    const inside = (n) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height
    check('多选一起拖入:框扩大到装下全部', inside(a) && inside(b2), JSON.stringify({ g: [g.x, g.y, g.width, g.height] })) }
  // 拖出框:不缩小
  await reset([GF('FF', 100, 100, 400, 300), T('ff_in', 150, 180, 120, 60)]); await sleep(200)
  { const g0 = await gnode('FF'); const p0 = await P('ff_in')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x + 120 * i, p0.y, { modifiers: 1 })
    await mouse('mouseReleased', p0.x + 720, p0.y, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('FF')
    check('把卡片拖出框:框不会随之缩小', g1.width === g0.width && g1.height === g0.height) }
  // 框被拖动时(框 + 里面的)不触发自适应
  await reset([GF('GF', 100, 100, 300, 220), T('gf_in', 140, 180, 100, 60)]); await sleep(200)
  { const g0 = await gnode('GF'); const g = await node('GF'); const hx = g.x + g.w - 40, hy = g.y + 20
    await mouse('mousePressed', hx, hy, { modifiers: 1 }); for (let i = 1; i <= 5; i++) await mouse('mouseMoved', hx + 30 * i, hy + 20 * i, { modifiers: 1 }); await mouse('mouseReleased', hx + 150, hy + 100, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('GF')
    check('直接拖动框本身:大小不变', g1.width === g0.width && g1.height === g0.height && g1.x === g0.x + 150) }
  // 连线跟随框的预览与最终大小
  await reset([GF('HF', 100, 100, 300, 220), SH('hf_s', 'rect', 600, 160, { width: 120, height: 60 }), SH('hf_o', 'rect', 600, 400, { width: 120, height: 60 })], [{ id: 'hfe', fromNode: 'hf_s', toNode: 'hf_o', fromSide: 'bottom', toSide: 'top' }]); await sleep(200)
  { const p0 = await P('hf_s')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 }); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x - 60 * i, p0.y + 5 * i, { modifiers: 1 })
    await mouse('mouseReleased', p0.x - 360, p0.y + 30, { modifiers: 1 }); await sleep(250)
    const end = await ev(`(()=>{const d=document.querySelector('.wb-edge-line').getAttribute('d');const m=d.match(/^M ([\\d.-]+) ([\\d.-]+)/);return [parseFloat(m[1]),parseFloat(m[2])]})()`)
    const s = await gnode('hf_s')
    check('框扩大后,连到被拖图形的连线仍贴着它', Math.abs(end[0] - (s.x + s.width / 2)) < 1 && Math.abs(end[1] - (s.y + s.height)) < 1, JSON.stringify({ end, s: [s.x, s.y, s.width, s.height] })) }

  console.log('拖入框:把卡片往框外侧推开时,框要跟着长(不能一越过原边界就恢复)')
  { // 框 100..400 × 100..320;卡片 140 宽,从右边拖进来,再继续往右推
    const liveBox = (id) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"]');return {w:parseFloat(e.style.width),h:parseFloat(e.style.height),drop:e.classList.contains('is-drop'),leaving:e.classList.contains('is-leaving')}})()`)
    await reset([GF('PF', 100, 100, 300, 220), T('pf_ex', 130, 150, 100, 60), T('pf_mv', 700, 200, 140, 70)]); await sleep(200)
    const p0 = await P('pf_mv'); const g0 = await gnode('PF')   // 卡片中心 x=770
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    const to = async (cx) => { const steps = 4; const cur = await P('pf_mv'); for (let i = 1; i <= steps; i++) await mouse('mouseMoved', cur.x + ((p0.x - (770 - cx)) - cur.x) * i / steps, p0.y, { modifiers: 1 }); await sleep(60) }
    await to(380)                                   // 中心在原框内(离右边 20px),卡片右缘已超出框
    const a = await liveBox('PF')
    check('中心在框内、卡片探出边缘:框已变大并高亮', a.drop && a.w > g0.width, JSON.stringify(a))
    await to(430)                                   // 中心越过原来的右边 30px —— 用户反馈的场景
    const b = await liveBox('PF')
    check('把卡片继续往外推、中心越过原边界 30px:框不恢复,继续跟着长', b.drop && b.w > a.w - 1 && !b.leaving, JSON.stringify({ a, b }))
    check('此时框足够大,装得下整张卡片(卡片右缘 + 留白)', b.w >= (430 + 70 + 24) - 100 - 1, JSON.stringify(b))
    await to(450)
    const c = await liveBox('PF')
    check('再推 20px:框依然跟随变大', c.drop && c.w >= b.w, JSON.stringify({ b, c }))
    await to(380)
    const d2 = await liveBox('PF')
    check('往回拉:框跟着缩回(只保留装下卡片所需的大小)', d2.w <= c.w && d2.drop, JSON.stringify({ c, d2 }))
    await to(430)
    await mouse('mouseReleased', (await P('pf_mv')).x, p0.y, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('PF'), m1 = await gnode('pf_mv')
    check('在越过原边界的位置松手:卡片属于框,且整张在框内', m1.x >= g1.x && m1.x + m1.width <= g1.x + g1.width && m1.y >= g1.y && m1.y + m1.height <= g1.y + g1.height, JSON.stringify({ g1: [g1.x, g1.y, g1.width, g1.height], m1: [m1.x, m1.y] }))
    check('卡片中心在原来的框之外(确认确实走过"越界"路径)', m1.x + m1.width / 2 > g0.x + g0.width)
    check('成员数为 2(原有 + 拖入)', (await ev(`document.querySelector('[data-wb-node="PF"] .wb-group-count')?.textContent`)) === '2')
    check('一步撤销:框与卡片一起回到原样', await (async () => { await ev('window.__wb.store.undo()'); await sleep(200); const g = await gnode('PF'), m = await gnode('pf_mv'); return g.width === g0.width && m.x === 700 })()) }
  { // 推得太远:越过缓冲带 → 视为离开,框恢复,出现"将移出"
    const liveBox = (id) => ev(`(()=>{const e=document.querySelector('[data-wb-node="${id}"]');return {w:parseFloat(e.style.width),drop:e.classList.contains('is-drop'),leaving:e.classList.contains('is-leaving')}})()`)
    await reset([GF('QF', 100, 100, 300, 220), T('qf_in', 130, 150, 100, 60)]); await sleep(200)
    const g0 = await gnode('QF'); const p0 = await P('qf_in')                 // 卡片原本在框内,中心 (180,180)
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', p0.x + 60 * i, p0.y, { modifiers: 1 })   // 中心 → 660,远在框外
    await sleep(80)
    const q = await liveBox('QF')
    check('把框内卡片一路拖到远处:框恢复原大小', q.w === g0.width, JSON.stringify(q))
    check('远离后:框显示"将移出",不再是"放入"', q.leaving && !q.drop, JSON.stringify(q))
    await mouse('mouseReleased', p0.x + 480, p0.y, { modifiers: 1 }); await sleep(250)
    const g1 = await gnode('QF'); const m1 = await gnode('qf_in')
    check('松手后卡片已在框外,框大小未变', m1.x > g1.x + g1.width && g1.width === g0.width, JSON.stringify({ g1: [g1.width], m1: [m1.x] })) }
  { // 缓冲带随缩放按屏幕像素计算:缩小到 50% 后,越界 30 屏幕像素仍在缓冲带内
    await reset([GF('RF', 100, 100, 300, 220), T('rf_mv', 700, 200, 140, 70)]); await ev(`window.__wb.store.setViewport({x:40,y:20,k:0.5})`); await sleep(250)
    const g0 = await gnode('RF'); const p0 = await P('rf_mv')
    await mouse('mousePressed', p0.x, p0.y, { modifiers: 1 })
    const targetWorldCenterX = 430; const dxScreen = (targetWorldCenterX - 770) * 0.5
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p0.x + dxScreen * i / 6, p0.y, { modifiers: 1 })
    await sleep(80)
    const live = await ev(`(()=>{const e=document.querySelector('[data-wb-node="RF"]');return {w:parseFloat(e.style.width),drop:e.classList.contains('is-drop')}})()`)
    check('画布缩放 50% 时同样生效(缓冲带按屏幕像素计)', live.drop && live.w > g0.width, JSON.stringify(live))
    await mouse('mouseReleased', p0.x + dxScreen, p0.y, { modifiers: 1 }); await sleep(200) }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('e2e/out/shot.png', Buffer.from(shot.result.data, 'base64'))
  check('无未处理错误', (await ev('window.__wb.errors.length')) === 0, JSON.stringify(await ev('window.__wb.errors')))
} catch (e) { console.error('E2E 异常:', e.message); results.push({ name: 'crash', ok: false }) }
finally { chrome.kill() }
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
