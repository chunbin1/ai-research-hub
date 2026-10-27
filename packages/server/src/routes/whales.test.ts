import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

// AUTH_DISABLED 必须在 auth.ts 求值前设好。本文件测管理员能写；未登录见 whales.auth.test.ts。
process.env.AUTH_DISABLED = 'true'

const { deleteInstitution, initWhaleTables, replaceFiling } = await import('../services/whales/store.ts')
const { whaleRoutes } = await import('./whales.ts')

async function appWithDb(synced: string[] = []) {
  initWhaleTables(new Database(':memory:'))
  const app = fastify()
  await app.register(whaleRoutes, {
    prefix: '/api',
    syncOne: async (slug: string) => {
      synced.push(slug)
      return 'empty'
    },
  })
  await app.ready()
  return app
}

test('没有申报时种子都在，状态是 empty', async () => {
  const app = await appWithDb()
  const res = await app.inject({ method: 'GET', url: '/api/whales' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.institutions.length, 7)
  assert.ok(body.valueNote.includes('美元'))
  assert.deepEqual(body.institutions.map((row: { slug: string }) => row.slug), [
    'berkshire', 'himalaya', 'hhlr', 'pershing', 'scion', 'ark', 'pelosi',
  ])
  assert.equal(body.institutions.find((row: { slug: string }) => row.slug === 'pelosi').source, 'house-fd')
  assert.equal(body.institutions[2].cik, '0001762304')
  assert.ok(body.institutions.every((row: { dataStatus: string; latest: unknown }) => row.dataStatus === 'empty' && row.latest === null))
  const missing = await app.inject({ method: 'GET', url: '/api/whales/nope' })
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(missing.json(), { error: 'not_found' })
})

test('名单 valueNote 跟着数据源走，有众议院披露时不只讲 13F', async () => {
  const app = await appWithDb()
  const mixed = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.match(mixed.valueNote, /13F/)
  assert.match(mixed.valueNote, /众议院/)

  assert.equal(deleteInstitution('pelosi'), true)
  const secOnly = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.equal(secOnly.institutions.some((row: { source: string }) => row.source === 'house-fd'), false)
  assert.match(secOnly.valueNote, /13F/)
  assert.equal(/众议院/.test(secOnly.valueNote), false)

  initWhaleTables(new Database(':memory:'))
  for (const slug of ['berkshire', 'himalaya', 'hhlr', 'pershing', 'scion', 'ark']) {
    assert.equal(deleteInstitution(slug), true)
  }
  const houseOnly = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.equal(houseOnly.institutions.length, 1)
  assert.match(houseOnly.valueNote, /申报区间/)
  assert.equal(/13F/.test(houseOnly.valueNote), false)
})

test('详情含相对上期的增减，未知机构 404', async () => {
  const app = await appWithDb()
  const line = (cusip: string, name: string, shares: number, value: number) => ({
    cusip, putCall: '' as const, shareType: 'SH', issuerName: name, titleOfClass: 'COM',
    shares, valueReported: value, valueUsd: value,
  })
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000001', form: '13F-HR',
    reportPeriod: '2026-03-31', filedAt: '2026-05-15', sourceUrl: 'https://www.sec.gov/prev',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line('037833100', 'APPLE INC', 10, 100), line('191216100', 'COCA COLA CO', 4, 40)],
  })
  replaceFiling({
    slug: 'berkshire', accession: '0001193125-26-000002', form: '13F-HR',
    reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: 'https://www.sec.gov/latest',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [line('037833100', 'APPLE INC', 15, 200), line('594918104', 'MICROSOFT CORP', 2, 20)],
  })

  const res = await app.inject({ method: 'GET', url: '/api/whales/berkshire' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.period.reportPeriod, '2026-06-30')
  assert.equal(body.previousPeriod.reportPeriod, '2026-03-31')
  const apple = body.positions.find((row: { cusip: string }) => row.cusip === '037833100')
  const created = body.positions.find((row: { cusip: string }) => row.cusip === '594918104')
  assert.equal(apple.change, 'increased')
  assert.equal(apple.shareDelta, 5)
  assert.equal(apple.shareType, 'SH')
  assert.equal(created.change, 'new')
  assert.equal(body.closed[0].change, 'closed')
  assert.equal(body.closed[0].cusip, '191216100')

  const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  const berkshire = list.institutions.find((row: { slug: string }) => row.slug === 'berkshire')
  const scion = list.institutions.find((row: { slug: string }) => row.slug === 'scion')
  assert.equal(berkshire.dataStatus, 'ready')
  assert.equal(berkshire.latest.positionCount, 2)
  assert.equal(berkshire.latest.totalValueUsd, 220)
  assert.equal(scion.dataStatus, 'empty')
})

test('WHALES=off 时列表也 404', async () => {
  const app = await appWithDb()
  const saved = process.env.WHALES
  process.env.WHALES = 'off'
  try {
    const res = await app.inject({ method: 'GET', url: '/api/whales' })
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { error: 'whales_disabled' })
    const detail = await app.inject({ method: 'GET', url: '/api/whales/berkshire' })
    assert.equal(detail.statusCode, 404)
    assert.deepEqual(detail.json(), { error: 'whales_disabled' })
    const added = await app.inject({
      method: 'POST', url: '/api/whales',
      payload: { cik: '0001234567', manager: '甲', nameZh: '甲公司', nameEn: 'Jia' },
    })
    assert.equal(added.statusCode, 404)
    assert.deepEqual(added.json(), { error: 'whales_disabled' })
  } finally {
    if (saved === undefined) delete process.env.WHALES
    else process.env.WHALES = saved
  }
})

test('管理员添加机构后出现在列表，冲突和坏 CIK 会拒绝', async () => {
  const synced: string[] = []
  const app = await appWithDb(synced)
  const created = await app.inject({
    method: 'POST',
    url: '/api/whales',
    payload: { cik: '1234567', manager: '李彦宏', nameZh: '百度', nameEn: 'Baidu, Inc.' },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().sync, 'pending')
  assert.equal(created.json().institution.slug, 'baidu-inc')
  assert.equal(created.json().institution.cik, '0001234567')
  assert.equal(created.json().institution.dataStatus, 'empty')
  assert.deepEqual(synced, ['baidu-inc'])

  const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.equal(list.institutions.at(-1).slug, 'baidu-inc')
  assert.equal(list.institutions.at(-1).manager, '李彦宏')

  const sameCik = await app.inject({
    method: 'POST', url: '/api/whales',
    payload: { cik: '1067983', manager: '别人', nameZh: '另一家', nameEn: 'Other Fund', slug: 'other-fund' },
  })
  assert.equal(sameCik.statusCode, 409)
  assert.equal(sameCik.json().error, 'cik_taken')

  const sameSlug = await app.inject({
    method: 'POST', url: '/api/whales',
    payload: { cik: '0000000099', manager: '别人', nameZh: '另一家', slug: 'Berkshire' },
  })
  assert.equal(sameSlug.statusCode, 409)
  assert.equal(sameSlug.json().error, 'slug_taken')

  const badCik = await app.inject({
    method: 'POST', url: '/api/whales',
    payload: { cik: '12ab', manager: '甲', nameZh: '甲公司' },
  })
  assert.equal(badCik.statusCode, 400)
  assert.equal(badCik.json().error, 'invalid_input')

  const chineseOnly = await app.inject({
    method: 'POST', url: '/api/whales',
    payload: { cik: '0000000099', manager: '甲', nameZh: '甲公司' },
  })
  assert.equal(chineseOnly.statusCode, 400)
  assert.equal(chineseOnly.json().error, 'slug_required')
})

test('管理员可以硬删机构，申报一起清掉', async () => {
  const app = await appWithDb()
  replaceFiling({
    slug: 'scion', accession: '0001193125-26-000009', form: '13F-HR',
    reportPeriod: '2025-09-30', filedAt: '2025-11-14', sourceUrl: 'https://www.sec.gov/scion',
    valueUnit: 'dollars', fetchedAt: '2026-10-27T00:00:00.000Z',
    positions: [{
      cusip: '69608A108', putCall: '', shareType: 'SH', issuerName: 'PALANTIR', titleOfClass: 'COM',
      shares: 1, valueReported: 10, valueUsd: 10,
    }],
  })
  const removed = await app.inject({ method: 'DELETE', url: '/api/whales/scion' })
  assert.equal(removed.statusCode, 200)
  assert.deepEqual(removed.json(), { ok: true })
  const detail = await app.inject({ method: 'GET', url: '/api/whales/scion' })
  assert.equal(detail.statusCode, 404)
  const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
  assert.equal(list.institutions.some((row: { slug: string }) => row.slug === 'scion'), false)
  const missing = await app.inject({ method: 'DELETE', url: '/api/whales/scion' })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error, 'not_found')
})

test('写入成功后立刻 201，慢同步在后台继续', async () => {
  initWhaleTables(new Database(':memory:'))
  let started = false
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const app = fastify()
  await app.register(whaleRoutes, {
    prefix: '/api',
    syncOne: async () => {
      started = true
      await gate
      return 'ok'
    },
  })
  await app.ready()
  try {
    const created = await Promise.race([
      app.inject({
        method: 'POST',
        url: '/api/whales',
        payload: { cik: '1234567', manager: '李彦宏', nameZh: '百度', nameEn: 'Baidu, Inc.' },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('POST 在同步结束前没有返回')), 400)),
    ])
    assert.equal(created.statusCode, 201)
    assert.equal(created.json().sync, 'pending')
    assert.equal(created.json().institution.slug, 'baidu-inc')
    assert.equal(started, true)
    const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
    assert.equal(list.institutions.some((row: { slug: string }) => row.slug === 'baidu-inc'), true)
  } finally {
    release()
    await app.close()
  }
})

test('后台拉取抛错时添加仍然 201，机构留在列表里', async () => {
  initWhaleTables(new Database(':memory:'))
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  const app = fastify()
  await app.register(whaleRoutes, {
    prefix: '/api',
    syncOne: async () => { throw new Error('SEC down') },
  })
  await app.ready()
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/whales',
      payload: { cik: '1234567', manager: '李彦宏', nameZh: '百度', nameEn: 'Baidu, Inc.' },
    })
    assert.equal(created.statusCode, 201)
    assert.equal(created.json().sync, 'pending')
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(warnings.some(line => line.includes('baidu-inc') && line.includes('SEC down')))
    const list = (await app.inject({ method: 'GET', url: '/api/whales' })).json()
    const added = list.institutions.find((row: { slug: string }) => row.slug === 'baidu-inc')
    assert.ok(added)
    assert.equal(added.syncError, 'SEC down')
  } finally {
    console.warn = original
    await app.close()
  }
})
