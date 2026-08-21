// packages/server/src/index.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import { randomBytes } from 'node:crypto'
import 'dotenv/config'

import { initDb } from './services/db.js'
import { initDocumentTable } from './services/documentStore.js'
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
initTraceTables(db)
initUserTables(db)
initUsageTable(db)
initChatTable(db)
initLLMConfigTable(db)
initSiteSettingsTable(db)
initEvalTables(db)
initWatchlistTable(db)
initSignalTables(db)
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
  startDailyScan({
    info: (m) => app.log.info(m),
    error: (m) => app.log.error(m),
  })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
