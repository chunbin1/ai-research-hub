// packages/server/src/routes/mcp.ts
//
// MCP 的 Streamable HTTP 入口。无状态:每个请求新建一个 server + transport,
// 不存会话 —— 工具全是只读查询,没有要跨请求保留的东西,服务重启也不会断连。
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from '../services/mcpServer.js'

/** 无状态模式下没有服务端推送流(GET)也没有会话可删(DELETE) */
const methodNotAllowed = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
}

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.post('/mcp', describeRoute(
    ['mcp'],
    'MCP（只读）',
    'Streamable HTTP。工具全是只读查询，无会话。响应由协议层直接写回。GET 与 DELETE 返回 405。',
  ), async (request, reply) => {
    const server = buildMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    // 响应由 transport 直接写 reply.raw,Fastify 不能再插手
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(request.raw, reply.raw, request.body)
    } catch (err) {
      app.log.error(err)
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }))
      }
    }
  })

  app.get('/mcp', async (_request, reply) => reply.status(405).header('Allow', 'POST').send(methodNotAllowed))
  app.delete('/mcp', async (_request, reply) => reply.status(405).header('Allow', 'POST').send(methodNotAllowed))
}
