import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchCnSymbols, shortenCandidates } from './cnSymbolSearch.ts'

function hintResponse(rows: string[]) {
  const hint = rows.length === 0 ? 'N' : rows.join('^')
  return new Response(`v_hint="${hint}";`, { status: 200 })
}

test('缩短候选先削组织形式,再逐字缩短,最多 4 个', () => {
  assert.deepEqual(shortenCandidates('智谱'), [])
  assert.deepEqual(shortenCandidates('智谱AI'), ['智谱'])
  assert.deepEqual(shortenCandidates('智谱华章'), ['智谱华', '智谱'])
  // 「有限公司」削完还剩「控股」,再削一刀;字符前缀用来补没有组织形式的全名。
  assert.deepEqual(shortenCandidates('腾讯控股有限公司'), [
    '腾讯控股', '腾讯', '腾讯控股有限公', '腾讯控股有限',
  ])
  assert.deepEqual(shortenCandidates('阿里巴巴集团'), ['阿里巴巴', '阿里巴巴集', '阿里巴', '阿里'])
})

test('「智谱」映射到港股 2513.HK,权证丢掉', async () => {
  const hits = await searchCnSymbols('智谱', {
    fetchImpl: (async () => hintResponse([
      'hk~02513~智谱~zp~GP',
      'hk~13093~智谱汇丰六乙购A~zphflyga~QZ',
      'hk~13154~智谱法兴六十购D~zpfxlsgd~QZ',
    ])) as unknown as typeof fetch,
  })
  assert.deepEqual(hits, [{ symbol: '2513.HK', name: '智谱', market: 'HK', exchange: 'Hong Kong' }])
})

test('拼音与英文别名走同一条映射,不另写特判', async () => {
  let inputs: string[] = []
  const fetchImpl = (async (url: string) => {
    inputs.push(new URL(url).searchParams.get('q') ?? '')
    return hintResponse(['hk~02513~\\u667a\\u8c31~zp~GP', 'hk~13093~智谱汇丰六乙购A~zphflyga~QZ'])
  }) as unknown as typeof fetch

  for (const q of ['zp', 'zhipu']) {
    inputs = []
    const hits = await searchCnSymbols(q, { fetchImpl })
    assert.deepEqual(inputs, [q], q)
    assert.equal(hits[0]?.symbol, '2513.HK', q)
    assert.equal(hits[0]?.name, '智谱', q)
  }
})

test('中文简称「腾讯」落到 0700.HK,人民币柜台、粉单和指数丢掉', async () => {
  const hits = await searchCnSymbols('腾讯', {
    fetchImpl: (async () => hintResponse([
      'sh~000847~腾讯济安~txja~ZS',
      'hk~00700~腾讯控股~txkg~GP',
      'hk~80700~腾讯控股r~txkgr~GP',
      'us~tctzf.ps~腾讯控股~txkg~GP',
      'hk~01698~腾讯音乐sw~txylsw~GP',
      'hk~13005~腾讯法兴七三购A~txfxqsga~QZ',
    ])) as unknown as typeof fetch,
  })
  assert.deepEqual(hits.map(h => h.symbol), ['0700.HK', '1698.HK'])
  assert.equal(hits[1].name, '腾讯音乐-SW')
})

test('「美团」丢掉粉单和 -WR 柜台', async () => {
  const hits = await searchCnSymbols('美团', {
    fetchImpl: (async () => hintResponse([
      'us~mpngy.ps~美团~mt~GP',
      'hk~03690~美团w~mtw~GP',
      'hk~83690~美团wr~mtwr~GP',
    ])) as unknown as typeof fetch,
  })
  assert.deepEqual(hits.map(h => h.symbol), ['3690.HK'])
  assert.equal(hits[0].name, '美团-W')
})

test('美股中文名「英伟达」落到 NVDA,ETF 和杠杆产品丢掉', async () => {
  const hits = await searchCnSymbols('英伟达', {
    fetchImpl: (async () => hintResponse([
      'us~nvda.oq~英伟达~ywd~GP',
      'us~nvdy.am~英伟达期权收益策略etf~ywd~GP',
      'hk~07388~南方2倍做空英伟达~nf~GP',
      'us~baba.n~阿里巴巴~albb~GP',
    ])) as unknown as typeof fetch,
  })
  assert.deepEqual(hits.map(h => [h.symbol, h.market, h.exchange]), [
    ['NVDA', 'US', 'NASDAQ'],
    ['BABA', 'US', 'NYSE'],
  ])
})

test('全名比简称长时回退,并且公司名必须是输入的前缀', async () => {
  const calls: string[] = []
  const hits = await searchCnSymbols('智谱华章', {
    fetchImpl: (async (url: string) => {
      const input = new URL(url).searchParams.get('q') ?? ''
      calls.push(input)
      if (input === '智谱') return hintResponse(['hk~02513~智谱~zp~GP', 'hk~13093~智谱汇丰六乙购A~zphflyga~QZ'])
      // 「智谱华」只有权证,滤完是空的,必须继续缩短
      if (input === '智谱华') return hintResponse(['hk~13862~智谱华泰六十购C~zphtlsgc~QZ'])
      return hintResponse([])
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(calls, ['智谱华章', '智谱华', '智谱'])
  assert.equal(hits[0]?.symbol, '2513.HK')
  assert.equal(hits[0]?.name, '智谱')
})

test('削掉「集团」后能对上法定中文名', async () => {
  const calls: string[] = []
  const hits = await searchCnSymbols('阿里巴巴集团', {
    fetchImpl: (async (url: string) => {
      const input = new URL(url).searchParams.get('q') ?? ''
      calls.push(input)
      if (input === '阿里巴巴') {
        return hintResponse([
          'us~baba.n~阿里巴巴~albb~GP',
          'us~babaf.ps~阿里巴巴~albb~GP',
          'hk~09988~阿里巴巴w~albbw~GP',
          'hk~89988~阿里巴巴wr~albbwr~GP',
        ])
      }
      return hintResponse([])
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(calls, ['阿里巴巴集团', '阿里巴巴'])
  assert.deepEqual(hits.map(h => h.symbol), ['BABA', '9988.HK'])
  assert.equal(hits[1].name, '阿里巴巴-W')
})

test('简称夹在更长的名字里时逐字缩短仍能对上', async () => {
  const calls: string[] = []
  const hits = await searchCnSymbols('美团点评', {
    fetchImpl: (async (url: string) => {
      const input = new URL(url).searchParams.get('q') ?? ''
      calls.push(input)
      if (input === '美团') return hintResponse(['hk~03690~美团w~mtw~GP'])
      return hintResponse([])
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(calls, ['美团点评', '美团点', '美团'])
  assert.equal(hits[0]?.symbol, '3690.HK')
})

test('缩短命中的名字不是输入前缀时不收', async () => {
  const hits = await searchCnSymbols('智谱华章', {
    fetchImpl: (async (url: string) => {
      const input = new URL(url).searchParams.get('q') ?? ''
      if (input === '智谱' || input === '智谱华') return hintResponse(['hk~01673~华章科技~hzkj~GP'])
      return hintResponse([])
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(hits, [])
})

test('空串不打网络', async () => {
  let called = false
  const hits = await searchCnSymbols('  ', {
    fetchImpl: (async () => { called = true; return hintResponse([]) }) as unknown as typeof fetch,
  })
  assert.deepEqual(hits, [])
  assert.equal(called, false)
})

test('没有 v_hint 时当成上游坏响应', async () => {
  await assert.rejects(
    () => searchCnSymbols('智谱', {
      fetchImpl: (async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch,
    }),
    (err: unknown) => err instanceof Error && /v_hint/.test(err.message),
  )
})
