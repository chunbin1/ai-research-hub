import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { absoluteArchiveUrl, createSecTransport, SEC_FETCH_TIMEOUT_MS, secGetText } from './sec.ts'

const INDEX = 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526000002/0001193125-26-000002-index.htm'

test('相对路径按 filing index 目录解析，根路径挂在 www.sec.gov', () => {
  assert.equal(
    absoluteArchiveUrl('info.xml', INDEX),
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526000002/info.xml',
  )
  assert.equal(
    absoluteArchiveUrl('./info.xml', INDEX),
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526000002/info.xml',
  )
  assert.equal(
    absoluteArchiveUrl('/Archives/edgar/data/1067983/000119312526000002/info.xml', INDEX),
    'https://www.sec.gov/Archives/edgar/data/1067983/000119312526000002/info.xml',
  )
})

test('只放行 www.sec.gov 和 data.sec.gov 的 https', () => {
  assert.equal(
    absoluteArchiveUrl('https://www.sec.gov/Archives/edgar/data/1/2/info.xml', INDEX),
    'https://www.sec.gov/Archives/edgar/data/1/2/info.xml',
  )
  assert.equal(
    absoluteArchiveUrl('https://data.sec.gov/submissions/CIK0001067983.json', INDEX),
    'https://data.sec.gov/submissions/CIK0001067983.json',
  )
  assert.equal(
    absoluteArchiveUrl('https://WWW.SEC.GOV./Archives/x.xml', INDEX),
    'https://www.sec.gov./Archives/x.xml',
  )
  for (const href of [
    'https://evil.example/info.xml',
    'http://www.sec.gov/Archives/x.xml',
    'http://data.sec.gov/submissions/CIK0001067983.json',
    'http://169.254.169.254/latest/meta-data',
    'https://www.sec.gov.evil.example/info.xml',
    '//evil.example/info.xml',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@www.sec.gov/Archives/x.xml',
    '',
  ]) {
    assert.throws(() => absoluteArchiveUrl(href, INDEX), /拒绝非 SEC/, href)
  }
})

test('getBytes 只下载 disclosures-clerk.house.gov', async () => {
  const transport = createSecTransport('test-agent', 0)
  if (!transport.getBytes) throw new Error('传输层没有 getBytes')
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(new Uint8Array([9]), { status: 200 })
  }) as typeof fetch
  try {
    const ok = 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2025/10075701.pdf'
    const bytes = await transport.getBytes(ok)
    assert.equal(bytes[0], 9)
    assert.deepEqual(calls, [ok])
    const dotted = 'https://disclosures-clerk.house.gov./public_disc/x.pdf'
    const dottedBytes = await transport.getBytes(dotted)
    assert.equal(dottedBytes[0], 9)
    assert.equal(calls.length, 2)
    for (const url of [
      'https://evil.example/file.pdf',
      'http://disclosures-clerk.house.gov/x.pdf',
      'https://user:pass@disclosures-clerk.house.gov/x.pdf',
      'https://disclosures-clerk.house.gov.evil.example/x.pdf',
      'https://www.sec.gov/Archives/x.pdf',
    ]) {
      await assert.rejects(() => transport.getBytes!(url), /拒绝非众议院披露地址/, url)
    }
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = original
  }
})

test('secGetText 使用 30 秒超时，挂起时抛失败而不是一直等', async () => {
  assert.equal(SEC_FETCH_TIMEOUT_MS, 30_000)
  const server = http.createServer(() => {})
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务没有端口')
  try {
    await assert.rejects(
      () => secGetText(`http://127.0.0.1:${address.port}/hang`, {
        userAgent: 'test-agent',
        wait: async () => {},
        timeoutMs: 40,
      }),
      (err: unknown) => err instanceof Error && err.message.startsWith('SEC 超时 '),
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
})
