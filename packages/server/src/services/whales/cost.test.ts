import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectSplit, estimateCosts, type CostLine } from './cost.ts'

function line(cusip: string, shares: number, price: number, putCall: CostLine['putCall'] = ''): CostLine {
  return { cusip, putCall, shareType: 'SH', shares, valueUsd: shares * price }
}

function period(reportPeriod: string, ...positions: CostLine[]) {
  return { reportPeriod, positions }
}

test('最早一期已经持有：成本从那一期期末价起算，fromStart 为 false', () => {
  const costs = estimateCosts([period('2025-03-31', line('A', 100, 10))])
  const a = costs.get('A||SH')
  assert.equal(a?.costPerShare, 10)
  assert.equal(a?.gain, 0)
  assert.equal(a?.since, '2025-03-31')
  assert.equal(a?.fromStart, false)
})

test('加仓按当期期末价加权，减仓不改每股成本', () => {
  const costs = estimateCosts([
    period('2025-03-31', line('B', 1, 1)),
    period('2025-06-30', line('A', 100, 10), line('B', 1, 1)),
    period('2025-09-30', line('A', 300, 20), line('B', 1, 1)),
    period('2025-12-31', line('A', 150, 25), line('B', 1, 1)),
  ])
  const a = costs.get('A||SH')
  // (100×10 + 200×20) / 300 = 16.67，减仓后仍是 16.67
  assert.ok(Math.abs((a?.costPerShare ?? 0) - 50 / 3) < 1e-9)
  assert.equal(a?.pricePerShare, 25)
  assert.ok(Math.abs((a?.gain ?? 0) - 0.5) < 1e-9)
  assert.equal(a?.since, '2025-06-30')
  assert.equal(a?.fromStart, true)
})

test('清仓后再买从头算', () => {
  const costs = estimateCosts([
    period('2025-03-31', line('A', 100, 10), line('B', 1, 1)),
    period('2025-06-30', line('B', 1, 1)),
    period('2025-09-30', line('A', 50, 30), line('B', 1, 1)),
  ])
  assert.equal(costs.get('A||SH')?.costPerShare, 30)
  assert.equal(costs.get('A||SH')?.since, '2025-09-30')
  assert.equal(costs.get('A||SH')?.fromStart, true)
})

test('拆股不当成加仓：股数 ×10、价格 ÷10，每股成本同步 ÷10', () => {
  const costs = estimateCosts([
    period('2024-03-31', line('NVDA', 100, 900)),
    period('2024-06-30', line('NVDA', 1000, 120)),
  ])
  assert.ok(Math.abs((costs.get('NVDA||SH')?.costPerShare ?? 0) - 90) < 1e-9)
})

test('拆股同一季又加仓：先按拆股调整，再把多出的股数按新价计入', () => {
  const costs = estimateCosts([
    period('2024-03-31', line('NVDA', 100, 900)),
    period('2024-06-30', line('NVDA', 1200, 120)),
  ])
  // (1000×90 + 200×120) / 1200 = 95
  assert.ok(Math.abs((costs.get('NVDA||SH')?.costPerShare ?? 0) - 95) < 1e-9)
})

test('股数不变、价格大跌不算拆股；股数翻倍、价格没变是加仓', () => {
  assert.equal(detectSplit(100, 100, 100, 45), null)
  assert.equal(detectSplit(100, 200, 100, 98), null)
  assert.equal(detectSplit(100, 400, 100, 26), 4)
  assert.equal(detectSplit(300, 100, 10, 29), 1 / 3)
  assert.equal(detectSplit(100, 1000, 900, 120), 10)
})

test('期权和本金行不估算', () => {
  const costs = estimateCosts([
    period('2025-03-31', line('A', 100, 10, 'Call'), { cusip: 'B', putCall: '', shareType: 'PRN', shares: 1000, valueUsd: 990 }),
  ])
  assert.equal(costs.size, 0)
})
