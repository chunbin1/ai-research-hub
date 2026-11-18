import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCik, normalizeSlug, slugFromNames } from './identity.ts'

test('CIK 补零到 10 位，非数字拒绝', () => {
  assert.equal(normalizeCik('1067983'), '0001067983')
  assert.equal(normalizeCik(' 0001067983 '), '0001067983')
  assert.equal(normalizeCik('7'), '0000000007')
  assert.equal(normalizeCik(''), null)
  assert.equal(normalizeCik('12ab'), null)
  assert.equal(normalizeCik('12345678901'), null)
})

test('短名收成 URL 片段，纯中文生成不了', () => {
  assert.equal(normalizeSlug(' My Fund '), 'my-fund')
  assert.equal(normalizeSlug('Baidu_Inc'), 'baidu-inc')
  assert.equal(normalizeSlug('中文'), null)
  assert.equal(normalizeSlug('foo/bar'), null)
  assert.equal(slugFromNames('Baidu, Inc.', '百度'), 'baidu-inc')
  assert.equal(slugFromNames('', '百度'), null)
  assert.equal(slugFromNames('HHLR Advisors, Ltd.', ''), 'hhlr-advisors-ltd')
})
