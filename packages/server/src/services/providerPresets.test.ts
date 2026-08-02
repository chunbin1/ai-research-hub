import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESETS,
  getPreset,
  isPrivateAddress,
  validateBaseURLSyntax,
  assertPublicBaseURL,
  BaseURLRejectedError,
} from './providerPresets.ts'

test('预置表:含 custom,id 唯一,非 custom 的 openai 项都带 baseURL', () => {
  const ids = PRESETS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('custom'))
  assert.ok(ids.includes('zhipu'))
  assert.ok(ids.includes('anthropic'))
  for (const p of PRESETS) {
    if (p.id === 'custom') { assert.equal(p.custom, true); continue }
    if (p.kind === 'openai') assert.ok(p.baseURL, `${p.id} 缺 baseURL`)
  }
})

test('getPreset:命中返回,未命中返回 null', () => {
  assert.equal(getPreset('zhipu')?.kind, 'openai')
  assert.equal(getPreset('anthropic')?.kind, 'anthropic')
  assert.equal(getPreset('nope'), null)
})

test('isPrivateAddress:IPv4 私网与特殊段全部拒绝', () => {
  for (const ip of [
    '0.0.0.0', '0.1.2.3',
    '10.0.0.1', '10.255.255.255',
    '127.0.0.1', '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1', '172.20.10.5', '172.31.255.255',
    '192.168.1.1',
  ]) assert.equal(isPrivateAddress(ip), true, `${ip} 应被拒绝`)
})

test('isPrivateAddress:公网 IPv4 放行,含私网段的边界外地址放行', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '11.0.0.1']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} 应放行`)
  }
})

test('isPrivateAddress:IPv6 回环 / ULA / 链路本地 / v4-mapped 全部拒绝', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} 应被拒绝`)
  }
})

test('isPrivateAddress:公网 IPv6 放行', () => {
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false)
})

test('isPrivateAddress:认不出的输入保守拒绝', () => {
  for (const s of ['', 'not-an-ip', '999.999.999.999']) {
    assert.equal(isPrivateAddress(s), true, `${s} 应保守拒绝`)
  }
})

test('validateBaseURLSyntax:必须 https', () => {
  assert.equal(validateBaseURLSyntax('http://api.example.com/v1').ok, false)
  assert.equal(validateBaseURLSyntax('ftp://api.example.com').ok, false)
  assert.equal(validateBaseURLSyntax('https://api.example.com/v1').ok, true)
})

test('validateBaseURLSyntax:畸形 URL 拒绝', () => {
  for (const s of ['', 'not a url', 'api.example.com/v1', 'https://']) {
    assert.equal(validateBaseURLSyntax(s).ok, false, `${s} 应被拒绝`)
  }
})

test('assertPublicBaseURL:字面量内网 IP 拒绝', async () => {
  // dns.lookup 对 IP 字面量直接返回,不发网络请求
  await assert.rejects(() => assertPublicBaseURL('https://127.0.0.1:8000/v1'), BaseURLRejectedError)
  await assert.rejects(() => assertPublicBaseURL('https://192.168.1.10/v1'), BaseURLRejectedError)
  await assert.rejects(() => assertPublicBaseURL('https://[::1]/v1'), BaseURLRejectedError)
  await assert.rejects(() => assertPublicBaseURL('https://169.254.169.254/latest'), BaseURLRejectedError)
})

test('assertPublicBaseURL:字面量公网 IP 放行', async () => {
  await assertPublicBaseURL('https://1.1.1.1/v1')
})

test('assertPublicBaseURL:http 与畸形 URL 也走同一个拒绝路径', async () => {
  await assert.rejects(() => assertPublicBaseURL('http://1.1.1.1/v1'), BaseURLRejectedError)
  await assert.rejects(() => assertPublicBaseURL('nonsense'), BaseURLRejectedError)
})
