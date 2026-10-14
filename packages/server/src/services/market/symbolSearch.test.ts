import { test } from 'node:test'
import assert from 'node:assert/strict'
import { YahooError } from './yahooClient.ts'
import { searchSymbols } from './symbolSearch.ts'

function yahooQuotes(quotes: unknown[]) {
  return new Response(JSON.stringify({ quotes, news: [] }), { status: 200 })
}

function cnHint(rows: string[]) {
  const hint = rows.length === 0 ? 'N' : rows.join('^')
  return new Response(`v_hint="${hint}";`, { status: 200 })
}

const ZHIPU_ROW = 'hk~02513~智谱~zp~GP'

function dispatch(handlers: { yahoo: () => Response; cn: (input: string) => Response }) {
  return (async (url: string) => {
    const u = String(url)
    if (u.includes('finance.yahoo.com')) return handlers.yahoo()
    if (u.includes('smartbox.gtimg.cn')) {
      return handlers.cn(new URL(u).searchParams.get('q') ?? '')
    }
    throw new Error(`unexpected url ${u}`)
  }) as unknown as typeof fetch
}

test('输入「智谱」返回港股 2513.HK', async () => {
  const hits = await searchSymbols('智谱', {
    fetchImpl: dispatch({
      yahoo: () => new Response(
        JSON.stringify({ finance: { error: { description: 'Invalid Search Query' } } }),
        { status: 400 },
      ),
      cn: () => cnHint([
        ZHIPU_ROW,
        'hk~13093~智谱汇丰六乙购A~zphflyga~QZ',
      ]),
    }),
  })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].symbol, '2513.HK')
  assert.equal(hits[0].name, '智谱')
  assert.equal(hits[0].market, 'HK')
})

test('「智谱AI」中文源排在 Yahoo 把汉字剥掉之后的美股前面', async () => {
  const hits = await searchSymbols('智谱AI', {
    fetchImpl: dispatch({
      yahoo: () => yahooQuotes([
        { symbol: 'AI', exchange: 'NYQ', quoteType: 'EQUITY', longname: 'C3.ai, Inc.', exchDisp: 'NYSE' },
      ]),
      cn: (input) => input === '智谱' ? cnHint([ZHIPU_ROW]) : cnHint([]),
    }),
  })
  assert.equal(hits[0].symbol, '2513.HK')
  assert.equal(hits[0].name, '智谱')
  assert.ok(hits.some(h => h.symbol === 'AI'))
})

test('英文代码仍以 Yahoo 为准,同代码不重复', async () => {
  const hits = await searchSymbols('2513', {
    fetchImpl: dispatch({
      yahoo: () => yahooQuotes([
        { symbol: '2513.HK', exchange: 'HKG', quoteType: 'EQUITY', longname: 'Z.AI Co., Ltd.', shortname: 'Z.AI', exchDisp: 'Hong Kong' },
      ]),
      cn: () => cnHint([ZHIPU_ROW]),
    }),
  })
  assert.deepEqual(hits.map(h => h.symbol), ['2513.HK'])
  assert.equal(hits[0].name, 'Z.AI Co., Ltd.')
})

test('中文源失败时英文搜索仍返回 Yahoo 结果', async () => {
  const hits = await searchSymbols('ALB', {
    fetchImpl: dispatch({
      yahoo: () => yahooQuotes([
        { symbol: 'ALB', exchange: 'NYQ', quoteType: 'EQUITY', longname: 'Albemarle Corporation', exchDisp: 'NYSE' },
      ]),
      cn: () => new Response('nope', { status: 500 }),
    }),
  })
  assert.equal(hits[0].symbol, 'ALB')
  assert.equal(hits[0].market, 'US')
})

test('两路都失败时抛出上游错误', async () => {
  await assert.rejects(
    () => searchSymbols('智谱', {
      fetchImpl: dispatch({
        yahoo: () => new Response('', { status: 500 }),
        cn: () => new Response('', { status: 500 }),
      }),
      sleep: async () => {},
    }),
    (err: unknown) => err instanceof YahooError,
  )
})

test('两路都空时返回空列表', async () => {
  const hits = await searchSymbols('没有这家公司', {
    fetchImpl: dispatch({
      yahoo: () => yahooQuotes([]),
      cn: () => cnHint([]),
    }),
  })
  assert.deepEqual(hits, [])
})
