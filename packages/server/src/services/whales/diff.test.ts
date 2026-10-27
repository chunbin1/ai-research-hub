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

test('上一期是空表时，本期全部算新建仓', () => {
  const diff = diffPositions([line('A', 1, 1)], [])
  assert.equal(diff.hasPrevious, true)
  assert.equal(diff.positions[0]?.change, 'new')
})
