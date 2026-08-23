// packages/server/src/index.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import { randomBytes } from 'node:crypto'
import 'dotenv/config'

import { initDb } from './services/db.js'
import { initDocumentTable, getAllDocuments, readRawMarkdown } from './services/documentStore.js'
import { initChunkFtsTable, countChunkFts } from './services/chunkFts.js'
import { reindexFts } from './services/reindex.js'
import { initDocCollection } from './services/documentVector.js'
import { initTraceTables } from './services/traceStore.js'
import { initUserTables } from './services/userStore.js'
import { initUsageTable } from './services/usageStore.js'
import { initChatTable } from './services/chatStore.js'
import { initLLMConfigTable } from './services/llmConfigStore.js'
import { initSiteSettingsTable } from './services/siteSettingsStore.js'
import { initEvalTables, markStaleRunsFailed } from './services/evalStore.js'
import { initWatchlistTable } from './services/watchlistStore.js'
import { initSignalTables } from './services/signalStore.js'
import { startDailyScan } from './jobs/dailyScan.js'
import { documentRoutes } from './routes/documents.js'
import { chatRoutes } from './routes/chat.js'
import { traceRoutes } from './routes/traces.js'
import { authRoutes } from './routes/auth.js'
import { evalRoutes } from './routes/eval.js'
import { llmConfigRoutes } from './routes/llmConfig.js'
import { siteSettingsRoutes } from './routes/siteSettings.js'
import { signalRoutes } from './routes/signals.js'

const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { colorize: true } } },
})

await app.register(cors, { origin: ['http://localhost:5173', 'http://localhost:4173'] })
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

const cookieSecret = process.env.COOKIE_SECRET
if (!cookieSecret) app.log.warn('COOKIE_SECRET 未设 — 用随机密钥,重启后登录态失效')
await app.register(cookie, { secret: cookieSecret || randomBytes(32).toString('hex') })

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
initTraceTables(db)
initUserTables(db)
initUsageTable(db)
initChatTable(db)
initLLMConfigTable(db)
initSiteSettingsTable(db)
initEvalTables(db)
initWatchlistTable(db)
initSignalTables(db)

// BM25 索引自愈:表是空的但库里有文档,说明索引没建过(首次上线)或刚因
// schema 变更被重建。这里直接回填 —— 纯本地 SQLite,不调任何 API,毫秒级。
// 不自愈的话 BM25 那一路会静默零召回,而这种静默失效我们已经吃过一次亏。
{
  const docs = getAllDocuments()
  if (docs.length > 0 && countChunkFts(db) === 0) {
    const out = reindexFts(db, docs.map(d => d.id), readRawMarkdown)
    const ok = out.filter(r => r.status === 'ok')
    const chunks = ok.reduce((n, r) => n + r.chunks, 0)
    console.info(`[chunkFts] 索引为空,已自动回填 ${ok.length}/${docs.length} 篇 / ${chunks} 块`)
  }
}
markStaleRunsFailed()
await initDocCollection()

await app.register(authRoutes, { prefix: '/api' })
await app.register(documentRoutes, { prefix: '/api' })
await app.register(chatRoutes, { prefix: '/api' })
await app.register(traceRoutes, { prefix: '/api' })
await app.register(evalRoutes, { prefix: '/api' })
await app.register(llmConfigRoutes, { prefix: '/api' })
await app.register(siteSettingsRoutes, { prefix: '/api' })
await app.register(signalRoutes, { prefix: '/api' })

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT) || 3001
try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// 放在 try/catch 外面:那个 catch 会 process.exit(1)。listen 一旦成功,
// 后台任务注册失败也不该把已经在监听的服务器带下去。
startDailyScan({
  info: (m) => app.log.info(m),
  error: (m) => app.log.error(m),
})
