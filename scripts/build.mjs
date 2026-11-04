// 构建:Client 打包成 dsh 的 __ModuleLoader__ 形态;Host 与 core 原样发布(纯 ESM,无依赖)。
//   node scripts/build.mjs        → dist/ 下生成可安装的 bundle 目录
import { build } from 'esbuild'
import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { thirdPartyNotices } from './third-party.mjs'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const PKG_NAME = pkg.name

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// ---- Client ----
const result = await build({
  entryPoints: [resolve(root, 'src/client/index.js')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: process.env.NODE_ENV !== 'development',
  jsx: 'transform',
  loader: { '.css': 'text' },
  // react 与 jsx-runtime 由 dsh 的模块表提供;其余全部打进包里
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
})
const code = result.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG_NAME)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
${code}
    return module.exports;
  }
});
`
await writeFile(resolve(out, 'client.js'), wrapped)

// ---- Host:只发布"入口可达"的文件(纯 ESM,无第三方依赖)----
// core 里有些文件只给 Client 用(已打进 client.js),不该随 Host 包发布:
// 否则它们的第三方导入在用户机器上无法解析,而且包会无谓变大。
// 做法:从 Host 入口静态追踪相对 import,只复制被引用到的文件。
const hostEntry = resolve(root, 'src/host/index.js')
const reach = new Set()
const walk = async (file) => {
  if (reach.has(file)) return
  reach.add(file)
  const src = await readFile(file, 'utf8')
  for (const m of src.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) await walk(resolve(dirname(file), m[1]))
}
await walk(hostEntry)
await walk(resolve(root, 'src/host/tools.js'))
for (const file of reach) {
  const rel = file.slice(resolve(root, 'src').length + 1)            // host/index.js、core/ops.js …
  const target = resolve(out, 'lib', rel)
  await mkdir(dirname(target), { recursive: true })
  await cp(file, target)
}
// Host 入口里的相对路径 ../core 在 lib/host → lib/core 下依然成立
await writeFile(resolve(out, 'index.js'), `export * from './lib/host/index.js'\n`)

// ---- 元数据 ----
await cp(resolve(root, 'locale'), resolve(out, 'locale'), { recursive: true })
await cp(resolve(root, 'assets/icon.svg'), resolve(out, 'icon.svg'))
await cp(resolve(root, 'cordis.patch.yml'), resolve(out, 'cordis.patch.yml'))
await writeFile(resolve(out, 'THIRD_PARTY_NOTICES.md'), (await thirdPartyNotices()).markdown)
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md']) await cp(resolve(root, f), resolve(out, f)).catch(() => {})

// 发布清单:以源码 package.json 为准,只去掉开发用的字段,保证"发出去的"与"源码里写的"不会漂移。
const { devDependencies, scripts, ...published } = pkg
const manifest = {
  ...published,
  type: 'module',
  exports: {
    '.': './index.js',
    './client': './client.js',
    './locale/*.json': './locale/*.json',
    './icon': './icon.svg',
    './package.json': './package.json',
  },
  files: ['index.js', 'client.js', 'lib', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'README.md', 'LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md'],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: {
      platform: 'web',
      immediately: true,
      external: [],
      inject: [
        '@deepseek-ai/dsh-api-session-controller',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-session',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-chat',
        '@deepseek-ai/dsh-client-ui-workspace',
      ],
    },
  },
}
await writeFile(resolve(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`built ${PKG_NAME}@${pkg.version} → ${out}  (client ${(wrapped.length / 1024).toFixed(0)} KB)`)
