// 检索评测:拿固定用例跑真实检索链路,输出可跨次比较的分层指标。
// 只花 embedding,不调用任何 LLM。
//
// 用法(在 packages/server 下,或用根目录的 pnpm eval:retrieval):
//   pnpm eval:retrieval
//   pnpm eval:retrieval --set=evalset/tencent-ecosystem.json
//   pnpm eval:retrieval --save=evalset/runs/before.json     保存本次结果
//   pnpm eval:retrieval --baseline=evalset/runs/before.json 与上次对比
//
// 典型用法是改动前后各跑一次:
//   git stash && pnpm eval:retrieval --save=/tmp/before.json && git stash pop
//   pnpm eval:retrieval --baseline=/tmp/before.json

// 必须是第一个 import:ESM 按顺序求值,晚于其他模块加载会让 ragConfig
// 等在模块作用域读 env 的地方拿到默认值。
import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { initDb } from '../src/services/db.js'
import { initDocumentTable, getAllDocuments } from '../src/services/documentStore.js'
import { initChunkFtsTable, searchBm25 } from '../src/services/chunkFts.js'
import { initDocCollection, searchChunks, isDocVectorAvailable } from '../src/services/documentVector.js'
import { hybridRetrieve } from '../src/services/retrieval.js'
import { RAG } from '../src/services/ragConfig.js'
import { scoreCase, summarize, type EvalCase, type CaseOutcome, type EvalSummary } from '../src/services/retrievalEval.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const setPath = flag('set') ?? defaultSet()
const savePath = flag('save')
const baselinePath = flag('baseline')

function defaultSet(): string {
  const files = readdirSync('evalset').filter(f => f.endsWith('.json'))
  if (files.length === 0) { console.error('evalset/ 下没有用例文件'); process.exit(1) }
  if (files.length > 1) {
    console.error(`evalset/ 下有多个用例文件,用 --set= 指定:\n  ${files.join('\n  ')}`)
    process.exit(1)
  }
  return join('evalset', files[0])
}

interface EvalFile { doc: string; cases: EvalCase[] }
const file = JSON.parse(readFileSync(setPath, 'utf8')) as EvalFile

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
await initDocCollection()

const doc = getAllDocuments().find(d => d.filename.includes(file.doc))
if (!doc) {
  console.error(`库里找不到文档「${file.doc}」。先上传它,或改 ${setPath} 的 doc 字段。`)
  process.exit(1)
}
if (!isDocVectorAvailable()) {
  console.error('向量库不可用 —— 评测会只剩 BM25 一路,结果没有意义。先启动 ChromaDB。')
  process.exit(1)
}

console.log(`评测集: ${setPath}`)
console.log(`文档:   ${doc.filename}(${doc.chunk_count} 块)`)
console.log(`配置:   maxK=${RAG.maxK} poolSize=${RAG.poolSize} rrfK=${RAG.rrfK}\n`)

const outcomes: CaseOutcome[] = []
const rows: string[] = []
for (const c of file.cases) {
  const r = await hybridRetrieve(c.question, doc.id, {
    vectorSearch: (q, d) => searchChunks(q, d),
    keywordSearch: (q, d, limit) => searchBm25(db, d, q, limit),
  }, { k: RAG.rrfK })

  const o = scoreCase(c, r.chunks)
  outcomes.push(o)

  // 命中块在两路各自的原始名次 —— 用于判断是谁把它捞上来的
  const k = o.rank ? r.meta.ranks[o.rank - 1] : null
  const mark = o.hit === null ? '·' : o.hit ? '✓' : '✗'
  rows.push([
    ` ${mark} ${c.id.padEnd(26)}`,
    String(o.rank ?? '—').padStart(4),
    String(k?.vectorRank ?? '—').padStart(5),
    String(k?.bm25Rank ?? '—').padStart(5),
    o.violations.length ? ` ⚠ ${o.violations.join(',')}` : '',
    `  ${c.question}`,
  ].join(''))
}

console.log('   用例                          名次  向量 BM25  问题')
console.log('   ' + '─'.repeat(76))
rows.forEach(r => console.log(r))

const s = summarize(outcomes)
const pct = (v: number | null) => (v === null ? '  —  ' : (v * 100).toFixed(1).padStart(5) + '%')

console.log(`\n命中率 ${s.hits}/${s.scored} = ${pct(s.hitRate)}   MRR ${s.mrr.toFixed(3)}   违规 ${s.violations}`)
console.log('\n按类型:')
for (const [tag, st] of Object.entries(s.byTag).sort((a, b) => (a[1].hitRate ?? 0) - (b[1].hitRate ?? 0))) {
  console.log(`  ${tag.padEnd(14)} ${st.hits}/${st.scored}  ${pct(st.hitRate)}`)
}

interface RunFile { at: string; config: typeof RAG; summary: EvalSummary; outcomes: CaseOutcome[] }

if (baselinePath) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8')) as RunFile
  const d = (now: number | null, then: number | null) =>
    now === null || then === null ? '  —  ' : `${now - then >= 0 ? '+' : ''}${((now - then) * 100).toFixed(1)}pt`
  console.log(`\n对比基线 ${baselinePath}(${base.at.slice(0, 16)}):`)
  console.log(`  命中率 ${pct(base.summary.hitRate)} → ${pct(s.hitRate)}   ${d(s.hitRate, base.summary.hitRate)}`)
  console.log(`  MRR    ${base.summary.mrr.toFixed(3)} → ${s.mrr.toFixed(3)}   ${(s.mrr - base.summary.mrr >= 0 ? '+' : '') + (s.mrr - base.summary.mrr).toFixed(3)}`)

  // 逐条列出翻转的用例 —— 总分持平也可能是「修好两个、弄坏两个」。
  const was = new Map(base.outcomes.map(o => [o.id, o]))
  const flips = outcomes.filter(o => was.has(o.id) && was.get(o.id)!.hit !== o.hit)
  const moved = outcomes.filter(o => was.has(o.id) && was.get(o.id)!.hit === o.hit && was.get(o.id)!.rank !== o.rank)
  if (flips.length) {
    console.log('\n  命中状态翻转:')
    for (const o of flips) console.log(`    ${was.get(o.id)!.hit ? '✓→✗ 变差' : '✗→✓ 变好'}  ${o.id}`)
  }
  if (moved.length) {
    console.log('\n  名次变化:')
    for (const o of moved) console.log(`    ${String(was.get(o.id)!.rank ?? '—').padStart(3)} → ${String(o.rank ?? '—').padStart(3)}  ${o.id}`)
  }
  if (!flips.length && !moved.length) console.log('\n  与基线完全一致。')
}

if (savePath) {
  mkdirSync(dirname(savePath), { recursive: true })
  const run: RunFile = { at: new Date().toISOString(), config: RAG, summary: s, outcomes }
  writeFileSync(savePath, JSON.stringify(run, null, 2))
  console.log(`\n已保存: ${savePath}`)
}
