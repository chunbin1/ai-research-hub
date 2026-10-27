// /api/docs 上的 Swagger UI。路径挂在 /api 下：nginx 和 Vite 都把 /api 反代到本服务，
// 不会被前端 SPA 的 try_files 吃掉，也不会变成可收录的站点页面。
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

const DESCRIPTION = [
  '研报站 HTTP API。',
  '公开读接口不需要登录，和页面上能看到的数据同一档。',
  '实盘持仓的上传需要 API Key，放在 Header：`Authorization: Bearer <key>` 或 `X-Holdings-Key: <key>`。',
  '密钥来自服务端环境变量 `HOLDINGS_API_KEY`，文档和示例里不会填写真实值。',
  '只在 HTTPS 上使用。不要把密钥放进查询串，也不要打进访问日志、错误日志或请求体日志。',
  '写研报、扫描信号、评估等接口走登录 Cookie，且多数仅管理员可用。',
].join('\n\n')

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: '研报站 API',
        description: DESCRIPTION,
        version: '0.1.0',
      },
      // 不写死域名。Try it out 用当前打开文档页的那个源，本地和生产都对。
      servers: [{ url: '/' }],
      tags: [
        { name: 'holdings', description: '实盘持仓。读公开；上传用 API Key，全量覆盖。' },
        { name: 'documents', description: '研报。列表和正文公开读。' },
        { name: 'signals', description: 'SuperTrend 信号看板。读公开。' },
        { name: 'whales', description: 'SEC 13F 大佬持仓。读公开，与实盘持仓无关。' },
        { name: 'chat', description: '针对单篇研报的问答。健康检查公开，提问需要登录。' },
        { name: 'auth', description: '登录状态与可用的登录方式。不返回任何密钥。' },
        { name: 'seo', description: '给 nginx / 爬虫用的 robots、sitemap 和 head 片段。' },
        { name: 'mcp', description: '只读 MCP（Streamable HTTP），供外部 AI 客户端连接。' },
        { name: 'meta', description: '进程健康检查。' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: '持仓上传密钥，即环境变量 HOLDINGS_API_KEY 的值。与 X-Holdings-Key 二选一。这里不要粘贴真实密钥到截图或日志里。',
          },
          holdingsKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Holdings-Key',
            description: '持仓上传密钥的另一种传法，值同样是 HOLDINGS_API_KEY。与 Bearer 二选一。',
          },
        },
      },
    },
    // 没标 tag 的路由（登录后的管理接口等）不进这份给第三方看的文档。
    // 只读说明不会带上 body / response schema，因此也不会改原来的校验。
    transform: (document) => {
      const result = jsonSchemaTransform(document)
      const tags = result.schema?.tags
      if (!tags || tags.length === 0) return { schema: { hide: true }, url: result.url }
      return result
    },
  })

  await app.register(fastifySwaggerUi, {
    routePrefix: '/api/docs',
    // 不持久化授权，刷新后授权框是空的，避免浏览器里留下密钥。
    uiConfig: {
      persistAuthorization: false,
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
    },
    theme: { title: '研报站 API' },
    uiHooks: {
      onRequest: async (_request, reply) => {
        reply.header('X-Robots-Tag', 'noindex')
      },
    },
  })
}
