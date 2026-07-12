// packages/server/src/index.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import 'dotenv/config'

import { initDb } from './services/db.js'
import { initDocumentTable } from './services/documentStore.js'
import { initDocCollection } from './services/documentVector.js'
import { initTraceTables } from './services/traceStore.js'
import { documentRoutes } from './routes/documents.js'
import { chatRoutes } from './routes/chat.js'
import { traceRoutes } from './routes/traces.js'

const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { colorize: true } } },
})

await app.register(cors, { origin: ['http://localhost:5173', 'http://localhost:4173'] })
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

const db = initDb()
initDocumentTable(db)
initTraceTables(db)
await initDocCollection()

await app.register(documentRoutes, { prefix: '/api' })
await app.register(chatRoutes, { prefix: '/api' })
await app.register(traceRoutes, { prefix: '/api' })

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT) || 3001
try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
