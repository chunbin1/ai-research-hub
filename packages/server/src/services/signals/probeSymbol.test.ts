import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeSymbol, ProbeError } from './probeSymbol.ts'
import { YahooError, type QuoteSeries } from '../market/yahooClient.ts'
import type { WatchlistEntry } from '../watchlistStore.ts'

function series(symbol: string, n: number, over: Partial<QuoteSeries> = {}): QuoteSeries {
  const bars = Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, high: 101, low: 99, close: 100,
  }))
  return { symbol, name: 'Rocket Lab Corporation', currency: 'USD', exchange: 'NasdaqGS', bars, rawClose: {}, ...over }
}

const noEntry = () => null

test('正常探测:归一化 + 公司身份 + 历史根数', async () => {
  const r = await probeSymbol(' nasdaq: rklb ', {
    fetchQuotes: async () => series('RKLB', 1218),
    findEntry: noEntry,
  })
  assert.equal(r.symbol, 'RKLB')
  assert.equal(r.market, 'US')
  assert.equal(r.name, 'Rocket Lab Corporation')
  assert.equal(r.currency, 'USD')
  assert.equal(r.bars, 1218)
  assert.equal(r.enough, true)
  assert.equal(r.alreadyListed, false)
  assert.equal(r.deleted, false)
})

test('港股代码归一化到 4 位', async () => {
  const r = await probeSymbol('700.HK', {
    fetchQuotes: async (s) => series(s, 1218, { name: 'Tencent Holdings Limited', currency: 'HKD' }),
    findEntry: noEntry,
  })
  assert.equal(r.symbol, '0700.HK')
  assert.equal(r.market, 'HK')
})

test('历史不足 120 根时 enough 为 false,但不算错误', async () => {
  // SPCX(SpaceX)2026-06-12 才上市,当前仅 49 根。应该允许添加,只是暂时不出信号。
  const r = await probeSymbol('NASDAQ: SPCX', {
    fetchQuotes: async () => series('SPCX', 49, { name: 'Space Exploration Technologies Corp.' }),
    findEntry: noEntry,
  })
  assert.equal(r.bars, 49)
  assert.equal(r.enough, false)
})

test('不支持的市场直接拒绝,不打网络', async () => {
  let called = false
  await assert.rejects(
    () => probeSymbol('002466', { fetchQuotes: async () => { called = true; return series('x', 1) }, findEntry: noEntry }),
    (e: unknown) => e instanceof ProbeError && e.kind === 'unsupported_market',
  )
  assert.equal(called, false, '归一化不通过时不该再去打 Yahoo')
})

test('Yahoo 查不到时抛 not_found', async () => {
  await assert.rejects(
    () => probeSymbol('NASDAQ: NOPE', {
      fetchQuotes: async () => { throw new YahooError('NOPE: 代码不存在', 'not_found') },
      findEntry: noEntry,
    }),
    (e: unknown) => e instanceof ProbeError && e.kind === 'not_found',
  )
})

test('上游其他故障抛 upstream,与「代码不存在」区分开', async () => {
  await assert.rejects(
    () => probeSymbol('NASDAQ: RKLB', {
      fetchQuotes: async () => { throw new YahooError('被限流', 'rate_limited') },
      findEntry: noEntry,
    }),
    (e: unknown) => e instanceof ProbeError && e.kind === 'upstream' && e.message === '被限流',
  )
})

test('连不上网络时给中文文案,不把 Node 的英文 TypeError 透出去', async () => {
  // Node 的 fetch 连接失败抛的是英文 "fetch failed",原样透到管理员界面
  // 会违反「用户可见文案一律中文」。
  await assert.rejects(
    () => probeSymbol('NASDAQ: RKLB', {
      fetchQuotes: async () => { throw new TypeError('fetch failed') },
      findEntry: noEntry,
    }),
    (e: unknown) => e instanceof ProbeError && e.kind === 'upstream'
      && e.message === '查询行情失败,请检查网络后重试',
  )
})

test('已在自选股中', async () => {
  const entry = { symbol: 'RKLB', enabled: 1 } as WatchlistEntry
  const r = await probeSymbol('NASDAQ: RKLB', {
    fetchQuotes: async () => series('RKLB', 1218),
    findEntry: () => entry,
  })
  assert.equal(r.alreadyListed, true)
  assert.equal(r.deleted, false)
})

test('曾被删除:alreadyListed 为 false,deleted 为 true', async () => {
  const entry = { symbol: 'RKLB', enabled: 0 } as WatchlistEntry
  const r = await probeSymbol('NASDAQ: RKLB', {
    fetchQuotes: async () => series('RKLB', 1218),
    findEntry: () => entry,
  })
  assert.equal(r.alreadyListed, false, '墓碑不算「已在自选股中」——它应该能被添加(复活)')
  assert.equal(r.deleted, true)
})
