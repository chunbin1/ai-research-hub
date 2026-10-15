// 接口文档页和导出的 OpenAPI。密钥只存在环境变量里，规范、示例和 HTML 都不得出现它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

const { initHoldingsTables } = await import('../services/holdingsStore.ts')
const { registerHttpRoutes } = await import('../http.ts')

const SECRET = 'super-secret-holdings-key'

async function docsApp() {
  process.env.HOLDINGS_API_KEY = SECRET
  const db = new Database(':memory:')
  initHoldingsTables(db)
  const app = fastify({ logger: false })
  await registerHttpRoutes(app)
  await app.ready()
  return app
}

test('文档页和 OpenAPI 规范覆盖持仓读写，且不包含密钥', async () => {
  const app = await docsApp()

  const page = await app.inject({ method: 'GET', url: '/api/docs' })
  assert.equal(page.statusCode, 200)
  assert.match(page.headers['content-type'] ?? '', /text\/html/)
  assert.equal(page.headers['x-robots-tag'], 'noindex')
  assert.equal(page.body.includes(SECRET), false)
  assert.match(page.body, /swagger-ui/)

  const specRes = await app.inject({ method: 'GET', url: '/api/docs/json' })
  assert.equal(specRes.statusCode, 200)
  assert.equal(specRes.headers['x-robots-tag'], 'noindex')
  const spec = specRes.json()
  const raw = specRes.body
  assert.equal(raw.includes(SECRET), false)

  assert.equal(spec.openapi, '3.0.3')
  assert.equal(spec.info.title, '研报站 API')
  assert.equal(spec.servers[0].url, '/')
  assert.equal(spec.components.securitySchemes.bearerAuth.type, 'http')
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer')
  assert.equal(spec.components.securitySchemes.holdingsKey.type, 'apiKey')
  assert.equal(spec.components.securitySchemes.holdingsKey.name, 'X-Holdings-Key')
  assert.match(raw, /HOLDINGS_API_KEY/)

  const put = spec.paths['/api/holdings'].put
  const get = spec.paths['/api/holdings'].get
  assert.equal(put.operationId, 'replaceHoldings')
  assert.equal(get.operationId, 'getHoldings')
  assert.ok(put.security.some((item: Record<string, unknown>) => 'bearerAuth' in item))
  assert.ok(put.security.some((item: Record<string, unknown>) => 'holdingsKey' in item))
  assert.equal(get.security, undefined)
  for (const code of ['200', '400', '401', '503']) {
    assert.ok(put.responses[code], `PUT 缺少 ${code}`)
  }
  assert.ok(get.responses['200'])
  assert.match(raw, /AAPL/)
  assert.match(raw, /0700\.HK/)
  assert.match(raw, /holdings_upload_disabled/)
  assert.match(raw, /invalid_input/)
  assert.match(raw, /同一计价币种/)

  const putSchema = put.requestBody.content['application/json'].schema
  const rowSchema = putSchema.properties.holdings.items
  assert.equal(putSchema.properties.holdings.maxItems, 500)
  assert.equal(rowSchema.properties.symbol.maxLength, 64)
  assert.equal(rowSchema.properties.name.maxLength, 200)
  for (const field of ['marketValue', 'cost', 'pnl']) {
    assert.match(rowSchema.properties[field].description, /同一计价币种/)
  }

  assert.ok(spec.paths['/api/signals'].get)
  assert.ok(spec.paths['/api/signals/events'].get)
  assert.ok(spec.paths['/api/signals/{symbol}/log'].get)
  assert.ok(spec.paths['/api/documents'].get)
  assert.ok(spec.paths['/api/documents/{id}'].get)
  assert.ok(spec.paths['/api/chat/health'].get)
  assert.ok(spec.paths['/api/auth/providers'].get)
  assert.ok(spec.paths['/health'].get)
  assert.equal(spec.paths['/api/documents']?.post, undefined)
  assert.equal(spec.paths['/api/llm-config'], undefined)

  const yaml = await app.inject({ method: 'GET', url: '/api/docs/yaml' })
  assert.equal(yaml.statusCode, 200)
  assert.match(yaml.body, /openapi: 3\.0\.3/)
  assert.equal(yaml.body.includes(SECRET), false)

  await app.close()
})
