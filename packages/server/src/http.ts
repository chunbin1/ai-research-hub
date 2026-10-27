// 全部 HTTP 路由。index.ts 和 OpenAPI 导出脚本共用这一份，避免文档漏挂。
import type { FastifyInstance } from 'fastify'
import { registerOpenApi } from './openapi/plugin.js'
import { describeRoute } from './openapi/doc.js'
import { authRoutes } from './routes/auth.js'
import { documentRoutes } from './routes/documents.js'
import { chatRoutes } from './routes/chat.js'
import { traceRoutes } from './routes/traces.js'
import { evalRoutes } from './routes/eval.js'
import { llmConfigRoutes } from './routes/llmConfig.js'
import { siteSettingsRoutes } from './routes/siteSettings.js'
import { signalRoutes } from './routes/signals.js'
import { holdingsRoutes } from './routes/holdings.js'
import { whaleRoutes } from './routes/whales.js'
import { mcpRoutes } from './routes/mcp.js'
import { seoRoutes } from './routes/seo.js'

export async function registerHttpRoutes(app: FastifyInstance): Promise<void> {
  // 必须在业务路由之前，swagger 才能收到后面注册的路由。
  await registerOpenApi(app)
  await app.register(authRoutes, { prefix: '/api' })
  await app.register(documentRoutes, { prefix: '/api' })
  await app.register(chatRoutes, { prefix: '/api' })
  await app.register(traceRoutes, { prefix: '/api' })
  await app.register(evalRoutes, { prefix: '/api' })
  await app.register(llmConfigRoutes, { prefix: '/api' })
  await app.register(siteSettingsRoutes, { prefix: '/api' })
  await app.register(signalRoutes, { prefix: '/api' })
  await app.register(holdingsRoutes, { prefix: '/api' })
  await app.register(whaleRoutes, { prefix: '/api' })
  await app.register(mcpRoutes, { prefix: '/api' })
  await app.register(seoRoutes, { prefix: '/api' })

  app.get('/health', describeRoute(
    ['meta'],
    '健康检查',
    '进程在听。返回 `{ status: "ok", timestamp }`。不查数据库。',
  ), async () => ({ status: 'ok', timestamp: new Date().toISOString() }))
}
