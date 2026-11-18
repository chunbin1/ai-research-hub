import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toSecid, inferEtfMarket, fetchEtfKlines, fetchEtfNavHistory,
  fetchEtfRealtimeBatch, fetchSseDailyShares, fetchSzseLatestShares, probeEtfInfo,
} from './etfClient.js'

test('inferEtfMarket & toSecid 识别沪深 6 位 ETF 代码', () => {
  assert.equal(inferEtfMarket('510300'), 'SH')
  assert.equal(inferEtfMarket('588000'), 'SH')
  assert.equal(inferEtfMarket('563300'), 'SH')
  assert.equal(inferEtfMarket('159952'), 'SZ')
  assert.equal(inferEtfMarket('600519'), null)
  assert.equal(toSecid('510300', 'SH'), '1.510300')
  assert.equal(toSecid('159952', 'SZ'), '0.159952')
})

test('fetchEtfKlines 解析东财日 K 线与涨跌幅', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: {
      name: '创业板ETF广发',
      klines: [
        '2026-11-16,1.462,1.418,1.467,1.410,13297982,1904635139.456,3.85,9.39',
        '2026-11-17,1.400,1.399,1.433,1.382,50674399,7120143080.344,3.60,35.77',
      ],
    },
  }))
  const res = await fetchEtfKlines('159952', 'SZ', '20261116', '20261117', { fetch: fakeFetch as never })
  assert.equal(res.name, '创业板ETF广发')
  assert.equal(res.bars.length, 2)
  assert.equal(res.bars[1].tradeDate, '2026-11-17')
  assert.equal(res.bars[1].close, 1.399)
  assert.equal(res.bars[1].amount, 7120143080.344)
  // 东财 volume 单位为手(100份),换算为份数
  assert.equal(res.bars[1].volume, 5067439900)
  assert.ok(Math.abs((res.bars[1].pctChange ?? 0) - ((1.399 - 1.418) / 1.418) * 100) < 0.01)
})

test('fetchEtfNavHistory 携带 Referer 并按页收集 DWJZ', async () => {
  const seenHeaders: unknown[] = []
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    seenHeaders.push(init?.headers)
    return new Response(JSON.stringify({
      Data: { LSJZList: [{ FSRQ: '2026-11-17', DWJZ: '1.4015' }, { FSRQ: '2026-11-16', DWJZ: '1.4185' }] },
    }))
  }
  const nav = await fetchEtfNavHistory('159952', 1, 20, { fetch: fakeFetch as never })
  assert.equal(nav['2026-11-17'], 1.4015)
  assert.equal(nav['2026-11-16'], 1.4185)
  assert.match(JSON.stringify(seenHeaders[0]), /fundf10\.eastmoney\.com/)
})

test('fetchEtfRealtimeBatch 解析 f2 价格、f38 总份额、f441 IOPV', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: {
      diff: [
        { f12: '159952', f14: '创业板ETF广发', f2: 1.413, f6: 1643068179.854, f38: 14165584896.0, f441: 1.4137 },
        { f12: '510300', f14: '沪深300ETF华泰柏瑞', f2: 4.051, f6: 2581014438.0, f38: 48343087616.0, f441: 4.0449 },
      ],
    },
  }))
  const map = await fetchEtfRealtimeBatch(
    [{ code: '159952', market: 'SZ' }, { code: '510300', market: 'SH' }],
    { fetch: fakeFetch as never },
  )
  assert.equal(map['159952'].iopv, 1.4137)
  assert.equal(map['159952'].totalShares, 14165584896.0)
  assert.equal(map['510300'].price, 4.051)
})

test('fetchSseDailyShares 把万份转为份 & fetchSzseLatestShares 解析 dqgm', async () => {
  const sseFetch = async () => new Response(JSON.stringify({
    result: [{ SEC_CODE: '510300', TOT_VOL: '4834308.77' }],
  }))
  const sse = await fetchSseDailyShares('2026-11-17', { fetch: sseFetch as never })
  assert.equal(sse['510300'], 48343087700)

  const szseFetch = async () => new Response(JSON.stringify([{
    metadata: {
      subname: '2026-11-18',
      cols: { dqgm: '当前规模<br>（万份）<br>（2026-11-17）' },
    },
    data: [{ sys_key: '<a href="..."><u>159952</u></a>', dqgm: '1,416,558.49' }],
  }]))
  const szse = await fetchSzseLatestShares('159952', { fetch: szseFetch as never })
  assert.deepEqual(szse, { snapshotDate: '2026-11-18', shareDate: '2026-11-17', totalShares: 14165584900 })
})

test('probeEtfInfo 识别有效 ETF 并拒绝非法代码', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: { f57: '510300', f58: '沪深300ETF华泰柏瑞' },
  }))
  assert.deepEqual(await probeEtfInfo('510300', { fetch: fakeFetch as never }), {
    code: '510300', market: 'SH', name: '沪深300ETF华泰柏瑞',
  })
  assert.equal(await probeEtfInfo('600519', { fetch: fakeFetch as never }), null)
})
