// packages/server/src/routes/mcp.ts
//
// MCP 的 Streamable HTTP 入口。无状态:每个请求新建一个 server + transport,
// 不存会话,服务重启也不会断连。
//
// 读工具不鉴权。upload_report 只在这次请求的 Authorization: Bearer 对上
// MCP_UPLOAD_KEY 时才注册。密钥不对、没带头、没配密钥,工具列表都和只读时一样。
// 不接受查询串里的密钥(会进访问日志),也不把密钥写进日志。
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from '../services/mcpServer.js'

/** JSON 正文上限。研报走工具参数,默认 1MB 会截断较长的一篇。 */
const MCP_BODY_LIMIT = 4 * 1024 * 1024

function configuredUploadKey(): string | null {
  const raw = process.env.MCP_UPLOAD_KEY
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  return key.length > 0 ? key : null
}

/** 先哈希再比较:长度不同时 timingSafeEqual 会抛,而且原始字节比较会把长度差暴露出来。 */
function keysMatch(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

/** 没配、没带头、密钥不对都是 false,调用方分不出这三种。 */
function mcpCanUpload(headers: IncomingHttpHeaders): boolean {
  const key = configuredUploadKey()
  if (!key) return false
  const authorization = headers.authorization
  if (typeof authorization !== 'string') return false
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  if (!match?.[1]) return false
  return keysMatch(key, match[1])
}

/** 无状态模式下没有服务端推送流(GET)也没有会话可删(DELETE) */
const methodNotAllowed = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
}

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.post('/mcp', {
    ...describeRoute(
      ['mcp'],
      'MCP',
      'Streamable HTTP，无会话。不带上传密钥时工具全是只读查询。请求头 Authorization: Bearer <MCP_UPLOAD_KEY> 且密钥正确时，这次连接会多出 upload_report，用来上传一篇新研报。密钥来自环境变量 MCP_UPLOAD_KEY；不配、没带或不对时看不到该工具。不要把密钥放进查询串或日志。响应由协议层直接写回。GET 与 DELETE 返回 405。',
    ),
    bodyLimit: MCP_BODY_LIMIT,
  }, async (request, reply) => {
    const server = buildMcpServer({ write: mcpCanUpload(request.headers), log: app.log })
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
