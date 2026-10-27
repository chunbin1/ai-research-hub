import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { absoluteArchiveUrl, SEC_FETCH_TIMEOUT_MS, secGetText } from './sec.ts'

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

test('只放行 www.sec.gov 和 data.sec.gov', () => {
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

test('secGetText 使用 30 秒超时，挂起时抛失败而不是一直等', async () => {
  assert.equal(SEC_FETCH_TIMEOUT_MS, 30_000)
  const server = http.createServer(() => {})
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务没有端口')
  let connections = 0
  server.on('connection', () => { connections += 1 })
  try {
    await assert.rejects(
      () => secGetText(`http://127.0.0.1:${address.port}/hang`, {
        userAgent: 'test-agent',
        wait: async () => {},
        timeoutMs: 40,
      }),
      (err: unknown) => err instanceof Error && err.message.startsWith('SEC 超时 '),
    )
    assert.equal(connections, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
})
