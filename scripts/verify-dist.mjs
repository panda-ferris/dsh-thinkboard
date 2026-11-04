// 发布前校验:对 dist/ 做"别人机器上会不会出问题"的检查。任何一项失败都以非零码退出。
//   node scripts/verify-dist.mjs
//
// 为什么需要:开发时 dist 是软链回项目目录,项目的 node_modules 总在手边,
// 缺依赖、引用了源码目录里的文件之类的问题全部被掩盖;只有换到干净目录才会暴露。

import { readFile, readdir, cp, rm, mkdir, stat } from 'node:fs/promises'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const problems = []
const ok = (msg) => console.log('  ✔', msg)
const bad = (msg) => { problems.push(msg); console.log('  ✖', msg) }

const manifest = JSON.parse(await readFile(join(dist, 'package.json'), 'utf8'))

// ---- 1. 清单字段 ----
console.log('清单')
for (const k of ['name', 'version', 'description', 'license', 'repository', 'keywords', 'engines']) {
  manifest[k] ? ok(`package.json.${k}`) : bad(`package.json 缺 ${k}`)
}
if (!manifest.engines?.dsh) bad('缺 engines.dsh —— 插件市场据此判断与当前 dsh 是否兼容')
if (!/^[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? '')) bad(`包名 "${manifest.name}" 不是合法的 npm 包名`)
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) bad(`版本 "${manifest.version}" 不是精确的 SemVer`)
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'README.md', 'icon.svg', 'cordis.patch.yml', 'client.js', 'index.js']) {
  await stat(join(dist, f)).then(() => ok(`文件 ${f}`), () => bad(`dist 缺文件 ${f}`))
}
// exports / files 指向的文件必须存在
for (const [k, v] of Object.entries(manifest.exports ?? {})) {
  if (typeof v !== 'string' || v.includes('*')) continue
  await stat(join(dist, v)).then(() => {}, () => bad(`exports["${k}"] 指向不存在的文件 ${v}`))
}
const patch = await readFile(join(dist, 'cordis.patch.yml'), 'utf8')
patch.includes(`name: '${manifest.name}'`) || patch.includes(`name: "${manifest.name}"`) || patch.includes(`name: ${manifest.name}`)
  ? ok('cordis.patch.yml 引用的包名与 package.json 一致')
  : bad('cordis.patch.yml 里的 name 与 package.json 的包名不一致 —— 安装后插件不会被加载')
const client = await readFile(join(dist, 'client.js'), 'utf8')
client.includes(`id: ${JSON.stringify(manifest.name)}`) ? ok('client.js 的模块 id 与包名一致') : bad('client.js 的模块 id 与包名不一致 —— 界面不会注册')

// ---- 2. 干净目录里加载 Host(没有任何 node_modules)----
console.log('干净目录加载 Host')
const tmp = join(tmpdir(), `wb-verify-${Date.now()}`)
await mkdir(tmp, { recursive: true })
await cp(dist, join(tmp, 'pkg'), { recursive: true })
try {
  const mod = await import(pathToFileURL(join(tmp, 'pkg', 'index.js')).href)
  for (const k of ['apply', 'inject', 'name']) k in mod ? ok(`Host 导出 ${k}`) : bad(`Host 缺少导出 ${k}`)
  if (typeof mod.createService !== 'function') bad('Host 缺少导出 createService')
} catch (e) {
  bad(`Host 在干净目录无法加载:${e.message}`)
}

// ---- 3. 发布包内的第三方/外部引用 ----
console.log('依赖与路径')
const files = []
const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? await walk(p) : files.push(p) } }
await walk(dist)
for (const f of files.filter((x) => x.endsWith('.js') && !x.endsWith('client.js'))) {
  const src = await readFile(f, 'utf8')
  for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    bad(`${relative(dist, f)} 引用了第三方模块 "${spec}":Host 包必须自包含`)
  }
}
const personal = /\/Users\/[^/\s'"]+|\/home\/[^/\s'"]+|C:\\Users\\/
for (const f of files.filter((x) => /\.(js|json|md|ya?ml|svg)$/.test(x))) {
  const src = await readFile(f, 'utf8')
  const m = src.match(personal)
  if (m) bad(`${relative(dist, f)} 含本机路径 "${m[0]}"`)
}
files.length ? ok(`共 ${files.length} 个文件,${(files.reduce((n, f) => n + 0, 0), '')}`.replace(/,$/, '')) : bad('dist 为空')

// ---- 4. Client 包 ----
console.log('Client')
try { new Function(client.replace(/^window\.__ModuleLoader__\.load\(/, 'void (')); ok('client.js 语法正确') } catch (e) { bad(`client.js 无法解析:${e.message}`) }
// 只允许依赖 dsh 提供的模块(react);其它 require 说明有东西没被打进包里
const requires = [...client.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
const outsiders = [...new Set(requires)].filter((r) => !['react', 'react-dom', 'react/jsx-runtime'].includes(r))
outsiders.length ? bad(`client.js 还在 require 未打包的模块:${outsiders.join(', ')}`) : ok('client.js 只依赖 dsh 提供的 react')

// ---- 5. 体积 ----
const size = (await Promise.all(files.map(async (f) => (await stat(f)).size))).reduce((a, b) => a + b, 0)
console.log(`体积 ${(size / 1024).toFixed(0)} KB`)
size > 3 * 1024 * 1024 && bad('发布包超过 3MB,检查是否混入了不该发布的文件')

await rm(tmp, { recursive: true, force: true })
console.log(problems.length ? `\n❌ ${problems.length} 个问题` : '\n✅ dist 校验通过')
process.exit(problems.length ? 1 : 0)
