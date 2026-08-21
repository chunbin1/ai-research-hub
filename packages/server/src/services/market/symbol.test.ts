import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSymbol } from './symbol.ts'

test('美股:剥掉交易所前缀', () => {
  assert.deepEqual(normalizeSymbol('NYSE: ALB'), { symbol: 'ALB', market: 'US' })
  assert.deepEqual(normalizeSymbol('NASDAQ: SGML'), { symbol: 'SGML', market: 'US' })
  assert.deepEqual(normalizeSymbol('NYSE American: SLI'), { symbol: 'SLI', market: 'US' })
})

test('港股:去掉前导 0 并统一 .HK', () => {
  assert.deepEqual(normalizeSymbol('09696.HK'), { symbol: '9696.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('01772.HK'), { symbol: '1772.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('2899.HK'), { symbol: '2899.HK', market: 'HK' })
})

test('A 股一律丢弃', () => {
  assert.equal(normalizeSymbol('002466'), null)
  assert.equal(normalizeSymbol('000792'), null)
  assert.equal(normalizeSymbol('600519.SH'), null)
})

test('非美非港的交易所丢弃', () => {
  assert.equal(normalizeSymbol('ASX: PLS'), null)
  assert.equal(normalizeSymbol('LSE: RIO'), null)
})

test('没有交易所前缀的裸字母一律拒绝', () => {
  // 研报里有「### 行业 ETF」「### A 股(中国)」这类标题,
  // 若接受裸字母会把 ETF / A 当成代码。
  assert.equal(normalizeSymbol('ETF'), null)
  assert.equal(normalizeSymbol('A'), null)
  assert.equal(normalizeSymbol('ALB'), null)
})

test('空白与大小写', () => {
  assert.deepEqual(normalizeSymbol('  nyse:alb  '), { symbol: 'ALB', market: 'US' })
  assert.equal(normalizeSymbol(''), null)
  assert.equal(normalizeSymbol('   '), null)
})
