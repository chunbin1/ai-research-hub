// 从 data/raw/*.md 重建 BM25(FTS5)索引。不调用任何 API,不花钱。
//
// 用法(在 packages/server 下,或用根目录的 pnpm reindex):
//   pnpm reindex                    重建全部文档
//   pnpm reindex --doc=doc_xxx      只重建一篇
//
// 什么时候需要跑:
//   · BM25 是后加的,存量文档的 FTS 表是空的 —— 首次上线必须跑一次
//   · 改了切块规则(markdownParser)之后
//   · 手工改过 data/raw/ 下的原文之后
//
// 注意:本脚本只重建关键词索引。向量索引在 ChromaDB 里,更换 embedding
// 模型后需要另行重建(维度会变,存量向量全部作废)。

// 必须是第一个 import:ESM 按顺序求值,晚于其他模块加载会让 ragConfig
// 等在模块作用域读 env 的地方拿到默认值。
import 'dotenv/config'
import { initDb } from '../src/services/db.js'
import { initDocumentTable, getAllDocuments, readRawMarkdown } from '../src/services/documentStore.js'
import { initChunkFtsTable } from '../src/services/chunkFts.js'
import { reindexFts } from '../src/services/reindex.js'

const args = process.argv.slice(2)
const only = args.find(a => a.startsWith('--doc='))?.slice('--doc='.length)

const unknown = args.filter(a => !a.startsWith('--doc='))
if (unknown.length) {
  console.error(`未知参数: ${unknown.join(' ')}`)
  process.exit(1)
}

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)

const all = getAllDocuments()
const targets = only ? all.filter(d => d.id === only) : all

if (only && targets.length === 0) {
  console.error(`找不到文档: ${only}`)
  process.exit(1)
}
if (targets.length === 0) {
  console.log('库里没有文档,无事可做。')
  process.exit(0)
}

console.log(`重建 ${targets.length} 篇的 BM25 索引…\n`)
const results = reindexFts(db, targets.map(d => d.id), readRawMarkdown)

const nameOf = new Map(targets.map(d => [d.id, d.filename]))
let ok = 0, missing = 0, chunks = 0
for (const r of results) {
  if (r.status === 'ok') { ok++; chunks += r.chunks } else { missing++ }
  const mark = r.status === 'ok' ? '✓' : '✗'
  const detail = r.status === 'ok' ? `${String(r.chunks).padStart(4)} 块` : '  原文缺失'
  console.log(`  ${mark} ${detail}  ${nameOf.get(r.docId) ?? r.docId}`)
}

console.log(`\n完成:${ok} 篇 / ${chunks} 块${missing ? `,${missing} 篇原文缺失` : ''}`)
if (missing) {
  console.log('原文缺失的文档在关键词检索里将永远零召回 —— 重新上传可修复。')
  process.exit(1)
}
