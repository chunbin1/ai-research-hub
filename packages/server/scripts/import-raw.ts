// 把 data/raw/*.md 登记进本地库:documents 行 + BM25 索引(+ 可选向量索引)。
//
// 用途:原文是从别处搬来的 —— 生产环境拉下来的语料、别人给的一批研报 ——
// 走不了上传接口,库里没有对应的 documents 行,站点看不见它们。
//
// 用法(在 packages/server 下,或用根目录的 pnpm import:raw):
//   pnpm import:raw                 导入 data/raw 下全部,并建向量索引
//   pnpm import:raw --no-vectors    只建 documents 行 + BM25,不调 embedding
//   pnpm import:raw --doc=doc_xxx   只导一篇
//
// ⚠️ 默认会调 embedding API(花钱)。想先看看会导入什么,加 --no-vectors。
//
// 与 reindex 的分工:reindex 是给**库里已有的**文档补 BM25 索引;这里是把
// 库里根本没有的文档登记进去。已存在的 id 再导一次是就地更新,不会重复。

// 必须是第一个 import:ESM 按顺序求值,晚于其他模块加载会让 ragConfig
// 等在模块作用域读 env 的地方拿到默认值。
import 'dotenv/config'
import { readdirSync } from 'node:fs'
import { initDb } from '../src/services/db.js'
import { initDocumentTable, readRawMarkdown } from '../src/services/documentStore.js'
import { initChunkFtsTable } from '../src/services/chunkFts.js'
import { importRawDocs } from '../src/services/importRaw.js'
import { initDocCollection, upsertChunks, searchChunks, isDocVectorAvailable } from '../src/services/documentVector.js'

const RAW_DIR = process.env.RAW_DIR ?? 'data/raw'

const args = process.argv.slice(2)
const only = args.find(a => a.startsWith('--doc='))?.slice('--doc='.length)
const withVectors = !args.includes('--no-vectors')

const unknown = args.filter(a => !a.startsWith('--doc=') && a !== '--no-vectors')
if (unknown.length) {
  console.error(`未知参数: ${unknown.join(' ')}`)
  process.exit(1)
}

let files: string[]
try {
  files = readdirSync(RAW_DIR).filter(f => f.endsWith('.md') && !f.startsWith('.'))
} catch {
  console.error(`读不到目录 ${RAW_DIR}(在 packages/server 下运行,或设 RAW_DIR)`)
  process.exit(1)
}

const docIds = files.map(f => f.slice(0, -'.md'.length))
const targets = only ? docIds.filter(id => id === only) : docIds

if (only && targets.length === 0) {
  console.error(`${RAW_DIR} 下找不到 ${only}.md`)
  process.exit(1)
}
if (targets.length === 0) {
  console.log(`${RAW_DIR} 下没有 .md 文件,无事可做。`)
  process.exit(0)
}

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)

console.log(`从 ${RAW_DIR} 导入 ${targets.length} 篇…\n`)
const results = importRawDocs(db, targets, readRawMarkdown)

let ok = 0, missing = 0, chunks = 0
for (const r of results) {
  if (r.status === 'ok') { ok++; chunks += r.chunks } else { missing++ }
  const mark = r.status === 'ok' ? '✓' : '✗'
  const detail = r.status === 'ok' ? `${String(r.chunks).padStart(4)} 块` : '  原文读不到'
  console.log(`  ${mark} ${detail}  ${r.filename}`)
}
console.log(`\ndocuments + BM25:${ok} 篇 / ${chunks} 块${missing ? `,${missing} 篇失败` : ''}`)

if (!withVectors) {
  console.log('\n--no-vectors:跳过向量索引。站点能列出文档,但检索只有 BM25 一路。')
  process.exit(missing ? 1 : 0)
}

// 向量索引是另一个失败域:要 embedding key、要 ChromaDB 活着。
// 前面的 documents 行和 BM25 已经落库了,这里失败不该把它们一起判死。
await initDocCollection()
if (!isDocVectorAvailable()) {
  console.error('\n向量库不可用 —— 检查 ZHIPU_API_KEY 与 ChromaDB(docker compose -f docker-compose.dev.yml up -d)。')
  console.error('documents 行与 BM25 索引已经建好了,补完环境后重跑本脚本即可补上向量。')
  process.exit(1)
}

console.log(`\n建向量索引(${chunks} 块,调 embedding API)…`)
for (const r of results) {
  if (r.status !== 'ok') continue
  await upsertChunks(r.docId, r.filename, r.parsed)
  console.log(`  ✓ ${String(r.chunks).padStart(4)} 块  ${r.filename}`)
}

// 自检:upsertChunks 内部把异常吞成一条 warn,只看它的返回值分不出成没成。
// 真发一次检索,拿回结果才算数。
const probe = results.find(r => r.status === 'ok')!
const hits = await searchChunks('毛利率', probe.docId, 3)
console.log(
  hits.length
    ? `\n完成。自检:向「${probe.filename}」查「毛利率」召回 ${hits.length} 块。`
    : `\n⚠️ 向量索引建完但自检零召回 —— 上面若有 upsertChunks failed 的 warn,就是它。`,
)
process.exit(missing || hits.length === 0 ? 1 : 0)
