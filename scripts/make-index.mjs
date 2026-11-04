// 生成 / 更新插件市场索引(index.json)。
//   node scripts/make-index.mjs [--out index.json] [--existing index.json] [--repo https://github.com/OWNER/REPO]
//
// 索引里每个版本都"钉死"到一个 Git 提交:用户安装到的永远是你发布时那份,之后再提交不会影响他们。
// 所以本脚本会拒绝以下情况:
//   - 工作区有未提交改动(索引指向的提交必须就是你测试过的那份)
//   - 该提交里没有与 package.json 版本一致的 dist/(插件按 dist/ 子目录安装)
//   - 同一个版本号已在索引里、但指向了不同的提交(已发布的版本不可变;要改就升版本号)

import { execFileSync } from 'node:child_process'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()
const die = (m) => { console.error('✖', m); process.exit(1) }

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const repoUrl = (arg('--repo') ?? pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+$/.test(repoUrl)) die(`仓库地址不规范:"${repoUrl}"(需要 https://host/owner/repo,可用 --repo 指定)`)

if (git('status', '--porcelain')) die('工作区有未提交的改动。先提交,再生成索引(索引必须指向你测试过的那份提交)。')
const commit = git('rev-parse', 'HEAD')
const timestamp = Number(git('log', '-1', '--format=%ct'))
let distPkg
try { distPkg = JSON.parse(git('show', 'HEAD:dist/package.json')) } catch { die('HEAD 提交里没有 dist/package.json。先 npm run build 并提交 dist/。') }
if (distPkg.version !== pkg.version) die(`dist 的版本(${distPkg.version})与 package.json(${pkg.version})不一致。重新 npm run build 并提交。`)
if (distPkg.name !== pkg.name) die(`dist 的包名(${distPkg.name})与 package.json(${pkg.name})不一致。`)

const iconSvg = await readFile(resolve(root, 'assets/icon.svg'))
const entry = {
  version: pkg.version,
  publishTimestamp: timestamp,
  source: { type: 'git', url: repoUrl, commit, path: 'dist' },
  engines: { dsh: pkg.engines?.dsh },
}

const outPath = resolve(arg('--out') ?? 'index.json')
const existingPath = arg('--existing') ?? outPath
let doc
try { doc = JSON.parse(await readFile(existingPath, 'utf8')) } catch { doc = undefined }
doc ??= {
  format: 1,
  title: { en: 'ThinkBoard plugins', zh: 'ThinkBoard 插件源' },
  description: { en: 'Releases of the ThinkBoard canvas for DeepSeek Harness.', zh: 'DeepSeek Harness 的 ThinkBoard 画布插件发行版本。' },
  plugins: [],
  metadata: {
    categories: { canvas: { title: { en: 'Canvas & notes', zh: '画布与笔记' } } },
    labels: { markdown: { title: 'Markdown' }, flowchart: { title: { en: 'Flowchart', zh: '流程图' } }, agent: { title: { en: 'Agent-editable', zh: 'agent 可编辑' } } },
  },
}
let plugin = doc.plugins.find((p) => p.name === pkg.name)
if (!plugin) {
  plugin = {
    name: pkg.name,
    title: { en: 'ThinkBoard', zh: 'ThinkBoard' },
    description: { en: 'An infinite canvas: Markdown and image cards, frames, flowchart shapes, labeled connections — editable by the built-in chat agent.', zh: '无限画布:Markdown 与图片卡片、框、流程图图形、带文字的连线,内置对话里的 agent 可直接读写。' },
    icon: `data:image/svg+xml;base64,${iconSvg.toString('base64')}`,
    author: pkg.author,
    homepage: pkg.homepage,
    repository: { url: repoUrl },
    metadata: { category: 'canvas', keywords: pkg.keywords?.filter((k) => k !== 'dsh-plugin'), labels: ['markdown', 'flowchart', 'agent'] },
    versions: [],
  }
  doc.plugins.push(plugin)
}
const same = plugin.versions.find((v) => v.version === pkg.version)
if (same && same.source.commit !== commit) die(`版本 ${pkg.version} 已发布过,且指向另一个提交(${same.source.commit.slice(0, 8)})。已发布的版本不可变——请升版本号。`)
plugin.versions = [entry, ...plugin.versions.filter((v) => v.version !== pkg.version)]
plugin.repository = { url: repoUrl }
plugin.homepage = pkg.homepage ?? plugin.homepage

// 用 dsh 自带的校验器检查(找得到就用;找不到只提示)
const candidates = [
  process.env.DSH_MARKET_INDEX_LIB,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
].filter(Boolean)
let validated = false
for (const c of candidates) {
  try {
    await access(c)
    const { parseMarketIndex, marketInstallTarget } = await import(pathToFileURL(c).href)
    const parsed = parseMarketIndex(doc, 'https://example.invalid/index.json')
    const v = parsed.plugins.find((p) => p.name === pkg.name).versions[0]
    console.log('✔ 通过 dsh 的索引校验器')
    console.log('  安装参数:', marketInstallTarget(pkg.name, v).spec)
    validated = true
    break
  } catch (e) { if (e?.name === 'MarketIndexError') die(`索引不合法:${e.message}`) }
}
if (!validated) console.log('⚠ 没找到 dsh 的索引校验器,未做格式校验(可设 DSH_MARKET_INDEX_LIB 指向 dsh-plugin-market-index/lib/index.js)')

await writeFile(outPath, JSON.stringify(doc, null, 2) + '\n')
console.log(`✔ 已写入 ${outPath}:${pkg.name}@${pkg.version} → ${commit.slice(0, 12)}`)
