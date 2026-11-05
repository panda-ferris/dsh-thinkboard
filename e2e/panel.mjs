// 真实 Panel(外壳)的浏览器测试:左侧列表的展开记忆、顶栏标题改名与列表同步。
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

await mkdir('e2e/out', { recursive: true })
await build({ entryPoints: ['e2e/harness.jsx'], bundle: true, outfile: 'e2e/out/bundle.js', format: 'iife', jsx: 'transform', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' })
await writeFile('e2e/out/index.html', '<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div><script src="bundle.js"></script>')

const port = 9470
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/wb-chrome-panel', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' })
let ws, id = 0; const pending = new Map(); const errors = []
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value }
const results = []
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(ok ? '  ✔' : '  ✖', name, info) }
const key = (k, code, vk, extra = {}) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...extra })
const dbl = async (x, y) => { for (let i = 0; i < 2; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: i + 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: i + 1 }) } }
const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)

async function load(url) {
  await send('Page.navigate', { url })
  for (let i = 0; i < 40 && (await ev('document.title')) !== 'READY'; i++) await sleep(150)
}
async function mount(boards) {
  await ev(`(()=>{const p=window.__panel;p.db.clear();${boards.map(([id, title]) => `p.mk(${JSON.stringify(id)},${JSON.stringify(title)},[{id:'n1',type:'text',x:100,y:100,width:200,height:100,text:'x'}])`).join(';')};window.__mountPanel()})()`)
  await sleep(700)
}
const url = 'file://' + resolve('e2e/out/index.html') + '?panel=1'

try {
  let targets
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(200) } }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception || {})).split('\n').slice(0, 3).join(' | ')); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').split('\n').slice(0, 3).join(' | ')) })
  await send('Page.enable'); await send('Runtime.enable')
  const sid = (await send('Page.addScriptToEvaluateOnNewDocument', { source: 'if(!sessionStorage.__keep){try{localStorage.clear()}catch(e){}}' })).result.identifier
  await load(url)

  console.log('左栏展开状态记忆')
  await mount([['b1', '第一张'], ['b2', '第二张']])
  check('全新环境:左栏默认展开', await ev(`!!document.querySelector('.wb-list')`))
  await ev(`document.querySelector('.wb-toolbar button[title="list.toggle"]').click()`); await sleep(200)
  check('点 ☰ 折叠左栏', await ev(`!document.querySelector('.wb-list')`))
  check('折叠状态写入本机存储', (await ev(`JSON.parse(localStorage.getItem('dsh.thinkboard.list.v1')).open`)) === false)
  // 模拟"退出再进入":保留 localStorage,重新加载页面
  await ev(`sessionStorage.__keep='1'`)
  await load(url); await mount([['b1', '第一张'], ['b2', '第二张']])
  check('重新进入:保持折叠(与上次退出一致)', await ev(`!document.querySelector('.wb-list')`))
  await ev(`document.querySelector('.wb-toolbar button[title="list.toggle"]').click()`); await sleep(200)
  check('再展开', await ev(`!!document.querySelector('.wb-list')`))
  await load(url); await mount([['b1', '第一张'], ['b2', '第二张']])
  check('重新进入:保持展开', await ev(`!!document.querySelector('.wb-list')`))
  // 本机存储损坏时回到默认,不崩
  await ev(`localStorage.setItem('dsh.thinkboard.list.v1','{坏的json')`)
  await load(url); await mount([['b1', '第一张']])
  check('存储内容损坏:回到默认展开,不报错', await ev(`!!document.querySelector('.wb-list')`) && errors.length === 0, JSON.stringify(errors))
  await ev(`localStorage.setItem('dsh.thinkboard.list.v1','{"open":"x"}')`)
  await load(url); await mount([['b1', '第一张']])
  check('存储内容类型不对:按展开处理', await ev(`!!document.querySelector('.wb-list')`))

  console.log('顶栏标题改名')
  await ev(`localStorage.clear()`)
  await load(url); await mount([['b1', '第一张'], ['b2', '第二张']])
  const titleText = () => ev(`document.querySelector('.wb-board-title')?.textContent ?? null`)
  const listNames = () => ev(`[...document.querySelectorAll('.wb-list-name')].map(e=>e.textContent)`)
  check('顶栏显示当前白板标题', (await titleText()) === '第一张', await titleText())
  check('顶栏标题可编辑的提示(鼠标悬停)', await ev(`document.querySelector('.wb-board-title').title === 'title.hint'`))
  let c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  check('双击顶栏标题进入编辑(出现输入框,内容为当前标题)', await ev(`document.querySelector('.wb-board-title-input')?.value === '第一张'`))
  check('进入编辑后输入框获得焦点并全选', await ev(`(()=>{const i=document.querySelector('.wb-board-title-input');return document.activeElement===i&&i.selectionStart===0&&i.selectionEnd===i.value.length})()`))
  await send('Input.insertText', { text: '改过的名字' }); await key('Enter', 'Enter', 13); await sleep(400)
  check('回车提交:顶栏显示新标题,退出编辑', (await titleText()) === '改过的名字' && await ev(`!document.querySelector('.wb-board-title-input')`), await titleText())
  check('侧栏列表同步显示新标题', JSON.stringify(await listNames()) === JSON.stringify(['改过的名字', '第二张']), JSON.stringify(await listNames()))
  check('数据层已改名(Host 侧)', await ev(`window.__panel.db.get('b1').board.title`) === '改过的名字')
  check('画布仍然保留(改名不会重置白板)', await ev(`!!document.querySelector('[data-wb-node="n1"]')`))
  // Esc 放弃
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await send('Input.insertText', { text: '不该保存' }); await key('Escape', 'Escape', 27); await sleep(300)
  check('Esc 放弃修改,标题不变', (await titleText()) === '改过的名字' && (await listNames())[0] === '改过的名字')
  // 失焦提交
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await send('Input.insertText', { text: '失焦提交' })
  await ev(`document.querySelector('.wb-board-title-input').blur()`); await sleep(400)
  check('点击别处(失焦)同样提交', (await titleText()) === '失焦提交' && (await listNames())[0] === '失焦提交')
  // 空标题不提交
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await ev(`(()=>{const i=document.querySelector('.wb-board-title-input');i.select()})()`); await key('Backspace', 'Backspace', 8); await key('Enter', 'Enter', 13); await sleep(300)
  check('空标题不提交,保持原标题', (await titleText()) === '失焦提交')
  // 只有空白字符
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await ev(`(()=>{const i=document.querySelector('.wb-board-title-input');i.select()})()`); await send('Input.insertText', { text: '   ' }); await key('Enter', 'Enter', 13); await sleep(300)
  check('全是空格也不提交', (await titleText()) === '失焦提交')
  // 首尾空格被裁剪
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await ev(`(()=>{const i=document.querySelector('.wb-board-title-input');i.select()})()`); await send('Input.insertText', { text: '  带空格  ' }); await key('Enter', 'Enter', 13); await sleep(400)
  check('首尾空格被裁剪', (await titleText()) === '带空格' && (await listNames())[0] === '带空格', await titleText())
  // 标题没变:不产生写入
  { const rev0 = await ev(`window.__panel.db.get('b1').rev`)
    c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200); await key('Enter', 'Enter', 13); await sleep(300)
    check('标题没改直接回车:不产生写入', (await ev(`window.__panel.db.get('b1').rev`)) === rev0) }
  // 输入法组合中回车不提交
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await ev(`(()=>{const i=document.querySelector('.wb-board-title-input');i.select();i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))})()`)
  await ev(`document.querySelector('.wb-board-title-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))`); await sleep(200)
  check('输入法组合中按回车(选词)不会提交', await ev(`!!document.querySelector('.wb-board-title-input')`))
  await key('Escape', 'Escape', 27); await sleep(200)
  // 键盘事件不泄漏到画布(在标题输入框里按退格/Delete 不会删元素)
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await ev(`window.__pstore.select(['n1'])`)
  await key('Delete', 'Delete', 46); await key('Backspace', 'Backspace', 8); await sleep(200)
  check('在标题输入框里按删除键不会删除画布上选中的元素', await ev(`window.__panel.db.get('b1').board.nodes.some((n) => n.id === 'n1') && !!document.querySelector('[data-wb-node="n1"]')`))
  await key('Escape', 'Escape', 27); await sleep(200)
  // 切换白板时退出编辑,不会把名字写到另一张
  c = await center('.wb-board-title'); await dbl(c.x, c.y); await sleep(200)
  await send('Input.insertText', { text: '不要串到别的白板' })
  await ev(`[...document.querySelectorAll('.wb-list-item')][1].click()`); await sleep(500)
  check('编辑中切换到另一张白板:不会把输入写到别的白板', (await titleText()) === '第二张' && (await ev(`window.__panel.db.get('b2').board.title`)) === '第二张')
  console.log('   [diag] 切走后 b1 标题 =', await ev(`window.__panel.db.get('b1').board.title`), ' b2 标题 =', await ev(`window.__panel.db.get('b2').board.title`))
  check('编辑中切走:未提交的输入被丢弃(与 Esc 一致),原白板保持"带空格"', (await ev(`window.__panel.db.get('b1').board.title`)) === '带空格', await ev(`window.__panel.db.get('b1').board.title`))
  // 列表里改名,顶栏同步
  await ev(`[...document.querySelectorAll('.wb-list-item')][1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50}))`); await sleep(150)
  await ev(`[...document.querySelectorAll('.wb-menu-item')].find(b=>b.textContent==='menu.rename').click()`); await sleep(200)
  await ev(`(()=>{const i=document.querySelector('.wb-list-item .wb-title-input');i.select()})()`); await send('Input.insertText', { text: '列表里改的' }); await key('Enter', 'Enter', 13); await sleep(500)
  check('在列表里改名:顶栏标题同步更新', (await titleText()) === '列表里改的', await titleText())
  check('在列表里改名:列表显示新名', (await listNames()).includes('列表里改的'))
  // 空白状态:没有白板时顶栏无标题可改
  await ev(`window.__panel.db.clear()`)

  console.log('对话引用:以对象(chip)加入输入框 / 点击聚焦')
  { await ev(`localStorage.clear()`); await load(url)
    // 两块白板;b1 绑定会话 S1
    await ev(`(()=>{const p=window.__panel;p.db.clear();p.mk('b1','规划板',[{id:'c1',type:'text',x:100,y:100,width:200,height:100,title:'登录方案',text:'用 OAuth'},{id:'c2',type:'shape',kind:'diamond',x:2000,y:1500,width:160,height:100,text:'已登录?'},{id:'c3',type:'group',x:100,y:400,width:300,height:200,label:'第一阶段'}]);p.mk('b2','另一块',[{id:'d1',type:'text',x:300,y:300,width:200,height:100,title:'别板卡片',text:'x'}]);localStorage.setItem('dsh.thinkboard.sessions.v1',JSON.stringify({b1:'S1',b2:'S1'}));window.__mountPanel()})()`); await sleep(900)
    const fake = (e) => ev(`JSON.stringify(window.__fake.${e})`)
    await ev(`window.__pstore.select(['c1','c2'])`); await sleep(250)
    check('选中元素后,对话区出现"作为上下文带入输入框"', await ev(`!!([...document.querySelectorAll('.wb-chat-ctx button')].find(b=>b.textContent==='chat.attach'))`))
    await ev(`[...document.querySelectorAll('.wb-chat-ctx button')].find(b=>b.textContent==='chat.attach').click()`); await sleep(250)
    { const calls = JSON.parse(await fake('calls'))
      check('点击后调用输入框的 addFiles 一次(而不是写入文本草稿)', calls.length === 1 && JSON.parse(await fake('drafts')).length === 0, JSON.stringify(calls.map((c) => c.refs.length)))
      const refs = calls[0].refs
      check('两个选中元素 → 两个对象,顺序按白板顺序', refs.length === 2 && refs[0].label === '登录方案' && refs[1].label === '已登录?', JSON.stringify(refs.map((r) => r.label)))
      check('对象来源为 thinkboard,外观为会话图标', refs.every((r) => r.source === 'thinkboard' && r.appearance === 'session'))
      check('对象的 ref 自带白板 id 与元素 id', refs[0].ref === '@[登录方案](dsh-thinkboard:b1/c1)', refs[0].ref)
      check('不带附件 id(没有附件被创建)', JSON.stringify(calls[0].ids) === '[]')
      check('成功后给出"已加入"提示', (await ev(`document.querySelector('.wb-chat-note')?.textContent`)) === 'chatref.attached') }
    // 输入框忙(正在发送)
    await ev(`window.__fake.shellBusy=true; window.__fake.calls.length=0; window.__fake.chips.length=0`)
    await ev(`window.__pstore.select(['c1'])`); await sleep(200)
    await ev(`[...document.querySelectorAll('.wb-chat-ctx button')].find(b=>b.textContent==='chat.attach').click()`); await sleep(250)
    check('输入框正在发送时:提示稍后再试,不降级成文本', (await ev(`document.querySelector('.wb-chat-note')?.textContent`)) === 'chatref.blocked' && JSON.parse(await fake('drafts')).length === 0)
    await ev(`window.__fake.shellBusy=false`)
    // 取不到输入框 → 降级为文本草稿
    await ev(`window.__fake.noShell=true; window.__fake.calls.length=0`)
    await ev(`[...document.querySelectorAll('.wb-chat-ctx button')].find(b=>b.textContent==='chat.attach').click()`); await sleep(250)
    { const d = JSON.parse(await fake('drafts'))
      check('取不到输入框对象时:降级为文本草稿(功能不丢)', d.length === 1 && /dsh-thinkboard:b1\/c1/.test(d[0].prompt) && d[0].whenDraftExists === 'append', JSON.stringify(d).slice(0, 160)) }
    // 接口抛错 → 同样降级
    await ev(`window.__fake.noShell=false; window.__fake.forThrows=true; window.__fake.drafts.length=0`)
    await ev(`[...document.querySelectorAll('.wb-chat-ctx button')].find(b=>b.textContent==='chat.attach').click()`); await sleep(250)
    check('输入框接口抛错时:降级为文本草稿,不崩', JSON.parse(await fake('drafts')).length === 1 && errors.length === 0, JSON.stringify(errors))
    await ev(`window.__fake.forThrows=false`)

    // ---- 点击对象 → 聚焦 ----
    await ev(`window.__pstore.select([])`); await ev(`window.__pstore.setViewport({x:0,y:0,k:1})`); await sleep(200)
    await ev(`window.__focusBus.request('b1','c2')`); await sleep(500)
    { const st = JSON.parse(await ev(`JSON.stringify(window.__pstore.getState().viewport)`)); const sel = await ev(`window.__pstore.getState().selection[0]`)
      const cv = await ev(`(()=>{const r=document.querySelector('.wb-canvas').getBoundingClientRect();return {w:r.width,h:r.height}})()`)
      const cx = (2000 + 80) * st.k + st.x, cy = (1500 + 50) * st.k + st.y
      check('点击引用:视口移到元素(元素中心落在画布中心)', Math.abs(cx - cv.w / 2) < 2 && Math.abs(cy - cv.h / 2) < 2, JSON.stringify({ st, cx, cy, cv }))
      check('点击引用:元素被选中', sel === 'c2') }
    // 跨白板:当前是 b1,引用指向 b2
    await ev(`window.__focusBus.request('b2','d1')`); await sleep(900)
    check('引用指向另一块白板:自动切换过去并聚焦', (await ev(`window.__pstore.getState().board?.id`)) === 'b2' && (await ev(`window.__pstore.getState().selection[0]`)) === 'd1')
    check('切换后顶栏标题随之变化', (await ev(`document.querySelector('.wb-board-title')?.textContent`)) === '另一块')
    // 元素已删除
    await ev(`window.__focusBus.request('b2','ghost')`); await sleep(500)
    check('引用的元素已不存在:给出提示,不崩', (await ev(`document.querySelector('.wb-toast')?.textContent`)) === 'chatref.focusMissing' && errors.length === 0)
    // 白板已删除
    await ev(`window.__focusBus.request('nope','x')`); await sleep(500)
    check('引用的白板已不存在:给出提示,不崩', (await ev(`document.querySelector('.wb-toast')?.textContent`)) === 'chatref.focusMissing')
    check('请求处理完后被清空(不会重复触发)', (await ev(`window.__focusBus.peek()`)) === null)
    // 聚焦时关闭搜索面板、不改动数据
    const before = await ev(`JSON.stringify(window.__panel.db.get('b1').board.nodes)`)
    await ev(`window.__focusBus.request('b1','c1')`); await sleep(900)
    check('聚焦只移动视口与选择,不修改白板数据', (await ev(`JSON.stringify(window.__panel.db.get('b1').board.nodes)`)) === before)
  }

  check('页面无未处理错误', errors.length === 0, JSON.stringify(errors))
} finally {
  const fails = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fails.length}/${results.length} 通过`)
  chrome.kill()
  process.exit(fails.length ? 1 : 0)
}
