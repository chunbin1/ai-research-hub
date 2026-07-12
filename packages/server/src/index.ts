// packages/server/src/index.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import 'dotenv/config'

const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { colorize: true } } },
})

await app.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:4173'],
})
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT) || 3001
try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
