import { test, expect } from 'vitest'
import { changeLabel, formatShareDelta, formatUsd, securityTitle, shareTypeLabel } from './whaleView'

test('市值按美元取整，股数差额带符号', () => {
  expect(formatUsd(267000000000).replace(/\D/g, '')).toBe('267000000000')
  expect(formatUsd(1000)).not.toContain('.')
  expect(formatShareDelta(1200).replace(/\D/g, '')).toBe('1200')
  expect(formatShareDelta(1200).startsWith('+')).toBe(true)
  expect(formatShareDelta(-40).startsWith('-')).toBe(true)
  expect(formatShareDelta(0)).toBe('0')
})

test('增减用中文，对不上 ticker 时用申报名称', () => {
  expect(changeLabel('new')).toBe('新建仓')
  expect(changeLabel('increased')).toBe('加仓')
  expect(changeLabel('decreased')).toBe('减仓')
  expect(changeLabel('closed')).toBe('清仓')
  expect(changeLabel('unchanged')).toBe('不变')
  expect(securityTitle({ ticker: 'AAPL', issuerName: 'APPLE INC' })).toBe('AAPL')
  expect(securityTitle({ ticker: null, issuerName: 'MICROSOFT CORP' })).toBe('MICROSOFT CORP')
})

test('股数不标注，本金和其它份额类型要能分开', () => {
  expect(shareTypeLabel('SH')).toBeNull()
  expect(shareTypeLabel(' sh ')).toBeNull()
  expect(shareTypeLabel('')).toBeNull()
  expect(shareTypeLabel('PRN')).toBe('本金')
  expect(shareTypeLabel('prn')).toBe('本金')
  expect(shareTypeLabel('OTHER')).toBe('OTHER')
})
