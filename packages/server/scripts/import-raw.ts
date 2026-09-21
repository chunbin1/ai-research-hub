// 把 data/raw/*.md 登记进本地库,并把两路索引重建到当前切块代次。
//
// 用途:原文是从别处搬来的 —— 生产环境拉下来的语料、别人给的一批研报 ——
// 走不了上传接口,库里没有对应的 documents 行,站点看不见它们。
//
// 用法(在 packages/server 下,或用根目录的 pnpm import:raw):
//   pnpm import:raw                 导入 data/raw 下全部,并把两路索引建到最新代
//   pnpm import:raw --no-vectors    只建 documents 行 + BM25,不调 embedding
//   pnpm import:raw --doc=doc_xxx   只处理一篇
//
// ⚠️ 默认会调 embedding API(花钱)。想先看看会导入什么,加 --no-vectors。
//
// **可续传**:已经是当前代次的文档直接跳过,不重新 embedding。跑到一半挂了
// 重跑一次即可 —— 成功的跳过,只补没做完的。中途失败的那篇会完整地停在旧代,
// 站点继续用旧索引服务,不会出现「FTS 是新的、向量是旧的」那种静默错块状态。
//
// 与 reindex 的分工:reindex 只重建 BM25 一路(不花钱,但会让两路代次错位);
// 这里是把两路一起推到同一代,是切块规则改动后的正确收尾。

// 必须是第一个 import:ESM 按顺序求值,晚于其他模块加载会让 ragConfig
// 等在模块作用域读 env 的地方拿到默认值。
import 'dotenv/config'
import { readdirSync } from 'node:fs'
import { initDb } from '../src/services/db.js'
import { initDocumentTable, readRawMarkdown } from '../src/services/documentStore.js'
import { initChunkFtsTable } from '../src/services/chunkFts.js'
import { initIndexStateTable } from '../src/services/indexState.js'
import { importRawDocs } from '../src/services/importRaw.js'
import { rebuildDocs, type RebuildOutcome } from '../src/services/indexRebuild.js'
import { embeddingModel } from '../src/services/embeddings.js'
import {
  initDocCollection, upsertChunks, countChunks, deleteByGen, stampLegacy,
  searchChunks, isDocVectorAvailable,
} from '../src/services/documentVector.js'

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
initIndexStateTable(db)

console.log(`从 ${RAW_DIR} 登记 ${targets.length} 篇…\n`)
const registered = importRawDocs(db, targets, readRawMarkdown)
const missingAtRegister = registered.filter(r => r.status === 'missing')
for (const r of missingAtRegister) console.log(`  ✗ 原文读不到  ${r.filename}`)

if (withVectors) {
  await initDocCollection()
  if (!isDocVectorAvailable()) {
    console.error('\n向量库不可用 —— 检查 ZHIPU_API_KEY 与 ChromaDB(docker compose -f docker-compose.dev.yml up -d)。')
    console.error('documents 行已经登记好了。补完环境后重跑本脚本,已完成的会自动跳过。')
    process.exit(1)
  }
}

const label: Record<RebuildOutcome['status'], string> = {
  skipped: '跳过 已是最新',
  rebuilt: '重建',
  missing: '原文读不到',
  failed: '失败',
}

console.log(`\n重建索引${withVectors ? '(两路)' : '(仅 BM25,--no-vectors)'}…`)
const results = await rebuildDocs(
  db,
  registered.filter(r => r.status === 'ok').map(r => r.docId),
  {
    readMarkdown: readRawMarkdown,
    stampLegacy,
    writeVectors: upsertChunks,
    countVectors: countChunks,
    deleteVectors: deleteByGen,
    embedModel: embeddingModel(),
  },
  {
    withVectors,
    onDone: o => {
      const mark = o.status === 'rebuilt' ? '✓' : o.status === 'skipped' ? '·' : '✗'
      const detail = o.status === 'failed' ? `${label[o.status]}:${o.error}` : label[o.status]
      console.log(`  ${mark} ${String(o.chunks).padStart(4)} 块  ${o.filename.slice(0, 28).padEnd(30)} ${detail}`)
    },
  },
)

const by = (s: RebuildOutcome['status']) => results.filter(r => r.status === s)
const failed = [...by('failed'), ...by('missing')]
console.log(
  `\n重建 ${by('rebuilt').length} 篇,跳过 ${by('skipped').length} 篇` +
  `${failed.length ? `,失败 ${failed.length} 篇` : ''}。`,
)

if (!withVectors) {
  console.log('\n--no-vectors:向量没动,这些文档的检索暂时只有 BM25 一路。')
  console.log('(状态表里 vec_gen 与 active_gen 不一致,检索侧会据此降级并记进 trace)')
  process.exit(failed.length ? 1 : 0)
}

// 自检:真发一次检索。每篇的向量条数在 rebuildDoc 里已经逐篇核过了,这里再
// 端到端确认一次「查得出来」—— 光有条数不代表 collection 真的能被检索。
const probe = results.find(r => r.status === 'rebuilt' || r.status === 'skipped')
if (probe) {
  const hits = await searchChunks('毛利率', probe.docId, 3, probe.gen)
  console.log(
    hits.length
      ? `\n自检:向「${probe.filename}」查「毛利率」召回 ${hits.length} 块(代次 ${probe.gen})。`
      : `\n⚠️ 自检零召回 —— 索引写进去了但查不出来,先别信这次重建。`,
  )
  if (hits.length === 0) process.exit(1)
}

if (failed.length) {
  console.log('\n失败的那几篇仍然完整地停在旧代,站点照常工作。修掉原因后重跑,已完成的会跳过。')
  process.exit(1)
}
console.log('\n完成。')
