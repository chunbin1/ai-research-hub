import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSymbol } from './symbol.ts'

test('美股:剥掉交易所前缀', () => {
  assert.deepEqual(normalizeSymbol('NYSE: ALB'), { symbol: 'ALB', market: 'US' })
  assert.deepEqual(normalizeSymbol('NASDAQ: SGML'), { symbol: 'SGML', market: 'US' })
  assert.deepEqual(normalizeSymbol('NYSE American: SLI'), { symbol: 'SLI', market: 'US' })
})

test('港股:数字补/截到 4 位', () => {
  // Yahoo 只认 4 位港股代码,实测:0700.HK 200 / 700.HK 404,
  // 9696.HK 200 / 09696.HK 404。所以既要去多余前导 0,也要补足到 4 位。
  assert.deepEqual(normalizeSymbol('09696.HK'), { symbol: '9696.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('01772.HK'), { symbol: '1772.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('2899.HK'), { symbol: '2899.HK', market: 'HK' })
  // 四位以下必须补零 —— 腾讯 0700、汇丰 0005、中国移动 0941
  assert.deepEqual(normalizeSymbol('0700.HK'), { symbol: '0700.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('700.HK'), { symbol: '0700.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('0005.HK'), { symbol: '0005.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('5.HK'), { symbol: '0005.HK', market: 'HK' })
  // 港交所的 5 位代码保持原样 —— padStart(4) 对它是空操作。
  // 实测这两个在 Yahoo 上都有效:80737.HK(深圳投控湾区发展)、87001.HK(汇贤产业信托)
  assert.deepEqual(normalizeSymbol('80737.HK'), { symbol: '80737.HK', market: 'HK' })
  assert.deepEqual(normalizeSymbol('87001.HK'), { symbol: '87001.HK', market: 'HK' })
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
