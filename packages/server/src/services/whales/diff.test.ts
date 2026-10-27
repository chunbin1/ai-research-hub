import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffPositions, type DiffLine } from './diff.ts'

function line(cusip: string, shares: number, valueUsd: number, putCall: DiffLine['putCall'] = ''): DiffLine {
  return {
    cusip,
    putCall,
    shareType: 'SH',
    issuerName: cusip,
    titleOfClass: 'COM',
    shares,
    valueUsd,
    valueReported: valueUsd,
  }
}

test('没有上一期时不把持仓标成新建仓', () => {
  const diff = diffPositions([line('A', 10, 100)], null)
  assert.equal(diff.hasPrevious, false)
  assert.equal(diff.positions[0]?.change, null)
  assert.equal(diff.positions[0]?.shareDelta, null)
  assert.deepEqual(diff.closed, [])
})

test('相对上期标出新建、加仓、减仓、不变和清仓', () => {
  const diff = diffPositions(
    [line('A', 15, 200), line('B', 5, 50), line('C', 8, 80), line('D', 3, 30)],
    [line('A', 10, 90), line('C', 8, 70), line('D', 9, 90), line('E', 4, 40)],
  )
  const byCusip = new Map(diff.positions.map(row => [row.cusip, row]))
  assert.equal(byCusip.get('A')?.change, 'increased')
  assert.equal(byCusip.get('A')?.shareDelta, 5)
  assert.equal(byCusip.get('A')?.valueDeltaUsd, 110)
  assert.equal(byCusip.get('B')?.change, 'new')
  assert.equal(byCusip.get('C')?.change, 'unchanged')
  assert.equal(byCusip.get('C')?.valueDeltaUsd, 10)
  assert.equal(byCusip.get('D')?.change, 'decreased')
  assert.equal(byCusip.get('D')?.shareDelta, -6)
  assert.equal(diff.closed.length, 1)
  assert.equal(diff.closed[0]?.cusip, 'E')
  assert.equal(diff.closed[0]?.change, 'closed')
  assert.equal(diff.closed[0]?.shares, 0)
  assert.equal(diff.closed[0]?.shareDelta, -4)
})

test('默认仍按股数，股数同为 0 时市值涨了也标成不变', () => {
  const diff = diffPositions([line('AAPL', 0, 15_000_000)], [line('AAPL', 0, 3_000_000)])
  assert.equal(diff.positions[0]?.change, 'unchanged')
  assert.equal(diff.positions[0]?.valueDeltaUsd, 12_000_000)
})

test('midpoint 按区间中点判增减，股数为 0 不会一律标成不变', () => {
  const held = (cusip: string, shares: number, valueUsd: number): DiffLine => ({
    ...line(cusip, shares, valueUsd),
    valueLabel: '1–2',
  })
  const diff = diffPositions(
    [held('AAPL', 0, 15_000_000), held('MSFT', 0, 3_000_000), held('GOOGL', 70, 3_000_000)],
    [held('AAPL', 0, 3_000_000), held('MSFT', 0, 3_000_000), held('GOOGL', 40, 3_000_000), held('AMZN', 0, 750_000)],
    'midpoint',
  )
  const byCusip = new Map(diff.positions.map(row => [row.cusip, row]))
  assert.equal(byCusip.get('AAPL')?.change, 'increased')
  assert.equal(byCusip.get('AAPL')?.shareDelta, 0)
  assert.equal(byCusip.get('AAPL')?.valueDeltaUsd, 12_000_000)
  assert.equal(byCusip.get('MSFT')?.change, 'unchanged')
  assert.equal(byCusip.get('GOOGL')?.change, 'unchanged')
  assert.equal(byCusip.get('GOOGL')?.shareDelta, 30)
  assert.equal(diff.closed[0]?.cusip, 'AMZN')
  assert.equal(diff.closed[0]?.change, 'closed')
})

test('上一期是空表时，本期全部算新建仓', () => {
  const diff = diffPositions([line('A', 1, 1)], [])
  assert.equal(diff.hasPrevious, true)
  assert.equal(diff.positions[0]?.change, 'new')
})
