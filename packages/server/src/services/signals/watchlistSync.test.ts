import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initWatchlistTable, listWatchlist } from '../watchlistStore.ts'
import { syncWatchlistFromMarkdown } from './watchlistSync.ts'

// 缩写版研报:标题里带代码,正文里也带代码 —— 只有标题里的应该被抽走
const MD = `# 碳酸锂产业链投资研究报告

## 第四部分：全球上市公司扫描

### 美股 / 国际

| 公司 | 代码 | 交易所 |
|---|---|---|
| Rio Tinto | RIO | NYSE |
| Pilbara Minerals | PLS | ASX |

## 5.1 天齐锂业（002466 / 09696.HK）★★★★☆

天齐正文内容,提到 NYSE: SQM 但这是正文,不该被抽取。

## 5.3 盐湖股份（000792）★★★★☆

盐湖正文。

## 5.5 Albemarle（NYSE: ALB）★★★★☆

Albemarle 正文。
`

beforeEach(() => {
  initWatchlistTable(new Database(':memory:'))
})

test('只从标题抽取,正文里的代码不进自选股', () => {
  const symbols = syncWatchlistFromMarkdown('doc_1', MD)
  assert.deepEqual(symbols.sort(), ['9696.HK', 'ALB'])
  // 正文表格里的 RIO / PLS、正文段落里的 SQM 都不该出现
  assert.deepEqual(listWatchlist().map(e => e.symbol).sort(), ['9696.HK', 'ALB'])
})

test('A 股标题不产生条目', () => {
  syncWatchlistFromMarkdown('doc_1', MD)
  assert.equal(listWatchlist().find(e => e.symbol === '000792'), undefined)
})

test('记录来源文档与原始标题', () => {
  syncWatchlistFromMarkdown('doc_1', MD)
  const alb = listWatchlist().find(e => e.symbol === 'ALB')!
  assert.equal(alb.source_doc, 'doc_1')
  assert.match(alb.source_text!, /Albemarle/)
})

test('重复同步幂等,来源保留第一次', () => {
  syncWatchlistFromMarkdown('doc_1', MD)
  syncWatchlistFromMarkdown('doc_2', MD)
  assert.equal(listWatchlist().length, 2)
  assert.equal(listWatchlist().find(e => e.symbol === 'ALB')!.source_doc, 'doc_1')
})

test('没有可抽标题的文档不产生条目', () => {
  assert.deepEqual(syncWatchlistFromMarkdown('doc_x', '# 宏观随笔\n\n## 一、总量\n\n正文。'), [])
  assert.equal(listWatchlist().length, 0)
})
