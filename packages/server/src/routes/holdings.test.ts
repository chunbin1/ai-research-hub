// 实盘持仓的 HTTP 契约。HOLDINGS_API_KEY 在请求时读取,同一文件里可以
// 既测「未配置」又测「密钥不对」——不用像 AUTH_DISABLED 那样拆进程。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify, { type FastifyInstance } from 'fastify'

const { initHoldingsTables } = await import('../services/holdingsStore.ts')
const { holdingsRoutes } = await import('./holdings.ts')
const { holdingsPutBodySchema } = await import('../openapi/holdingsSchemas.ts')

const KEY = 'test-holdings-key'

function position(symbol: string, marketValue: number, pnl = 500) {
  return {
    symbol,
    ...(symbol === 'AAPL' ? { name: 'Apple' } : {}),
    shares: symbol === 'AAPL' ? 10 : 100,
    marketValue,
    cost: 1500,
    pnl,
  }
}

async function freshApp(now?: () => Date) {
  delete process.env.HOLDINGS_API_KEY
  const db = new Database(':memory:')
  initHoldingsTables(db)
  const app = fastify()
  await app.register(holdingsRoutes, { prefix: '/api', now })
  await app.ready()
  return app
}

function put(
  app: FastifyInstance,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
) {
  return app.inject({ method: 'PUT', url: '/api/holdings', headers, payload })
}

test('未配置密钥时上传返回 503,读接口仍是空快照', async () => {
  const app = await freshApp()
  const putRes = await put(app, { authorization: `Bearer ${KEY}` }, { holdings: [position('AAPL', 2000)] })
  assert.equal(putRes.statusCode, 503)
  assert.deepEqual(putRes.json(), { error: 'holdings_upload_disabled' })

  process.env.HOLDINGS_API_KEY = '   '
  const blank = await put(app, { authorization: `Bearer ${KEY}` }, { holdings: [position('AAPL', 2000)] })
  assert.equal(blank.statusCode, 503)

  const getRes = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.equal(getRes.statusCode, 200)
  assert.deepEqual(getRes.json(), { updatedAt: null, holdings: [] })
})

test('缺密钥、密钥错误或密钥在查询串里都不能上传', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const app = await freshApp()
  // freshApp 会清掉环境变量,这里重新打开上传
  process.env.HOLDINGS_API_KEY = KEY

  const seeded = await put(
    app,
    { authorization: `Bearer ${KEY}` },
    { holdings: [position('AAPL', 2000)] },
  )
  assert.equal(seeded.statusCode, 200)

  const attempts: Array<{ headers?: Record<string, string>; url?: string }> = [
    {},
    { headers: { authorization: 'Bearer wrong' } },
    { headers: { 'x-holdings-key': 'wrong' } },
    { url: `/api/holdings?key=${KEY}` },
  ]
  for (const attempt of attempts) {
    const res = await app.inject({
      method: 'PUT',
      url: attempt.url ?? '/api/holdings',
      headers: attempt.headers,
      payload: { holdings: [position('TSLA', 9, 1)] },
    })
    assert.equal(res.statusCode, 401, JSON.stringify(attempt))
    assert.deepEqual(res.json(), { error: 'unauthorized' })
    const body = JSON.stringify(res.json())
    assert.equal(body.includes(KEY), false)
    assert.equal(body.includes('wrong'), false)
  }

  const getRes = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.equal(getRes.json().holdings.length, 1)
  assert.equal(getRes.json().holdings[0].symbol, 'AAPL')
})

test('Bearer 上传后按市值计算仓位占比,读接口不需要密钥', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const app = await freshApp(() => new Date('2026-10-15T08:00:00.000Z'))
  process.env.HOLDINGS_API_KEY = KEY

  const putRes = await put(app, { authorization: `Bearer ${KEY}` }, {
    holdings: [position('AAPL', 2000), position('0700.HK', 3000, -200)],
  })
  assert.equal(putRes.statusCode, 200)
  assert.deepEqual(putRes.json(), {
    updatedAt: '2026-10-15T08:00:00.000Z',
    holdings: [
      { symbol: 'AAPL', name: 'Apple', shares: 10, marketValue: 2000, cost: 1500, pnl: 500, weight: 0.4 },
      { symbol: '0700.HK', name: null, shares: 100, marketValue: 3000, cost: 1500, pnl: -200, weight: 0.6 },
    ],
  })

  const getRes = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.equal(getRes.statusCode, 200)
  assert.deepEqual(getRes.json(), putRes.json())
})

test('X-Holdings-Key 再次上传整份替换,空数组清空后读接口回到无数据', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const times = ['2026-10-15T08:00:00.000Z', '2026-10-15T09:00:00.000Z', '2026-10-15T10:00:00.000Z']
  let i = 0
  const app = await freshApp(() => new Date(times[i++]!))
  process.env.HOLDINGS_API_KEY = KEY
  const headers = { 'x-holdings-key': KEY }

  const first = await put(app, headers, { holdings: [position('AAPL', 2000), position('0700.HK', 3000)] })
  assert.equal(first.statusCode, 200)
  assert.equal(first.json().holdings.map((row: { symbol: string }) => row.symbol).join(','), 'AAPL,0700.HK')

  const second = await put(app, { authorization: `bearer ${KEY}` }, { holdings: [position('TSLA', 800, 80)] })
  assert.equal(second.statusCode, 200)
  assert.equal(second.json().updatedAt, '2026-10-15T09:00:00.000Z')
  assert.deepEqual(second.json().holdings.map((row: { symbol: string }) => row.symbol), ['TSLA'])
  assert.equal(second.json().holdings[0].weight, 1)

  const cleared = await put(app, headers, { holdings: [] })
  assert.equal(cleared.statusCode, 200)
  assert.deepEqual(cleared.json(), { updatedAt: null, holdings: [] })

  const getRes = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.deepEqual(getRes.json(), { updatedAt: null, holdings: [] })
})

test('非法请求体返回 400 且不覆盖已有快照', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const app = await freshApp(() => new Date('2026-10-15T08:00:00.000Z'))
  process.env.HOLDINGS_API_KEY = KEY
  const headers = { authorization: `Bearer ${KEY}` }
  assert.equal((await put(app, headers, { holdings: [position('AAPL', 2000)] })).statusCode, 200)

  const bad = await put(app, headers, {
    holdings: [{ symbol: 'TSLA', shares: 1, marketValue: 1, cost: 1, pnl: 'nope' }],
  })
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().error, 'invalid_input')

  const dup = await put(app, headers, {
    holdings: [position('AAPL', 1), { ...position('AAPL', 2), symbol: ' AAPL ' }],
  })
  assert.equal(dup.statusCode, 400)

  const getRes = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.equal(getRes.json().updatedAt, '2026-10-15T08:00:00.000Z')
  assert.deepEqual(getRes.json().holdings.map((row: { symbol: string }) => row.symbol), ['AAPL'])
})

test('持仓条数、代码和名称超长时返回 400 且不覆盖已有快照', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const app = await freshApp(() => new Date('2026-10-15T08:00:00.000Z'))
  process.env.HOLDINGS_API_KEY = KEY
  const headers = { authorization: `Bearer ${KEY}` }
  assert.equal((await put(app, headers, { holdings: [position('AAPL', 2000)] })).statusCode, 200)

  const tooMany = Array.from({ length: 501 }, (_, index) => position(`S${index}`, 1, 0))
  const overRows = await put(app, headers, { holdings: tooMany })
  assert.equal(overRows.statusCode, 400)
  assert.equal(overRows.json().error, 'invalid_input')
  assert.match(overRows.json().message, /500/)

  const longSymbol = await put(app, headers, {
    holdings: [{ ...position('AAPL', 1), symbol: 'A'.repeat(65) }],
  })
  assert.equal(longSymbol.statusCode, 400)
  assert.equal(longSymbol.json().error, 'invalid_input')
  assert.match(longSymbol.json().message, /64/)

  const longName = await put(app, headers, {
    holdings: [{ ...position('TSLA', 1), name: '名'.repeat(201) }],
  })
  assert.equal(longName.statusCode, 400)
  assert.equal(longName.json().error, 'invalid_input')
  assert.match(longName.json().message, /200/)

  const unchanged = await app.inject({ method: 'GET', url: '/api/holdings' })
  assert.equal(unchanged.json().updatedAt, '2026-10-15T08:00:00.000Z')
  assert.deepEqual(unchanged.json().holdings.map((row: { symbol: string }) => row.symbol), ['AAPL'])

  const atLimit = await put(app, headers, {
    holdings: [{ ...position('A'.repeat(64), 9, 1), name: '名'.repeat(200) }],
  })
  assert.equal(atLimit.statusCode, 200)
  assert.equal(atLimit.json().holdings[0].symbol, 'A'.repeat(64))
  assert.equal(atLimit.json().holdings[0].name, '名'.repeat(200))

  const padded = await put(app, headers, {
    holdings: [{ ...position(` ${'B'.repeat(64)} `, 3, 1), name: ` ${'称'.repeat(200)} ` }],
  })
  assert.equal(padded.statusCode, 200)
  assert.equal(padded.json().holdings[0].symbol, 'B'.repeat(64))
  assert.equal(padded.json().holdings[0].name, '称'.repeat(200))
})

test('Zod schema 与运行时使用同一组长度上限', () => {
  const row = {
    symbol: ` ${'A'.repeat(64)} `,
    name: ` ${'名'.repeat(200)} `,
    shares: 1,
    marketValue: 1,
    cost: 1,
    pnl: 1,
  }
  assert.equal(holdingsPutBodySchema.safeParse({ holdings: [row] }).success, true)
  assert.equal(holdingsPutBodySchema.safeParse({
    holdings: [{ ...row, symbol: 'A'.repeat(65) }],
  }).success, false)
  assert.equal(holdingsPutBodySchema.safeParse({
    holdings: [{ ...row, name: '名'.repeat(201) }],
  }).success, false)
  assert.equal(holdingsPutBodySchema.safeParse({
    holdings: Array.from({ length: 501 }, (_, index) => ({ ...row, symbol: `S${index}` })),
  }).success, false)
})

test('市值合计为 0 时仓位占比为 0', async () => {
  process.env.HOLDINGS_API_KEY = KEY
  const app = await freshApp(() => new Date('2026-10-15T08:00:00.000Z'))
  process.env.HOLDINGS_API_KEY = KEY
  const res = await put(app, { 'x-holdings-key': KEY }, {
    holdings: [position('AAPL', 0, 0), position('0700.HK', 0, 0)],
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json().holdings.map((row: { weight: number }) => row.weight), [0, 0])
})
