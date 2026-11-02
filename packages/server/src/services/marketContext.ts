// 问答时附在研报段落后面的对照数据。
// 只取这篇研报标题里的美股 / 港股代码，不扫正文，和自选股抽取同一口径。
import { isSignalsEnabled } from './signals/scanner.js'
import { signalBoard } from './signals/board.js'
import { titlesInMarkdown } from './signals/watchlistSync.js'
import { extractTickersFromTitles } from './signals/tickerExtractor.js'
import { isWhalesEnabled } from './whales/enabled.js'
import { holdingsForTickers, type WhaleSymbolHolding } from './whales/bySymbol.js'

const HEADER = '--- 相关信号与名家持仓 ---'

function siteOrigin(): string {
  return (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n)
}

function shares(n: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(n)
}

function usd(n: number): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)} 美元`
}

type Side = NonNullable<ReturnType<typeof signalBoard>[number]['daily']>

function sideText(label: string, side: Side | null, closeRaw: number | null, flips?: number): string {
  if (!side) return `${label}：没有信号`
  const dir = side.trend === 1 ? '多头' : '空头'
  const close = closeRaw ?? side.closeAdj
  const flip = side.flipDate
    ? `最近翻转 ${side.flipDate}（价格 ${num(side.flipPrice)}）`
    : '日志里没有翻转'
  const whip = flips == null ? '' : `，近 90 天翻转 ${flips} 次`
  return `${label}：${dir}，截至 ${side.barDate}，收盘 ${num(close)}，止损线 ${num(side.stopLine)}，距止损 ${Math.abs(side.distPct).toFixed(1)}%（按复权价），${flip}${whip}`
}

function signalText(symbol: string, rows: ReturnType<typeof signalBoard>): string {
  const row = rows.find(item => item.symbol.toUpperCase() === symbol.toUpperCase())
  if (!row) return '信号：不在自选股里，没有信号。'
  const name = row.name ? `${symbol}（${row.name}）` : symbol
  if (!row.daily && !row.weekly) {
    const why = row.status === 'invalid' ? '代码无效' : '行情不足'
    return `信号：${name} 在自选股里，但${why}，还没有信号。`
  }
  return [
    `信号：${name}`,
    sideText('日线', row.daily, row.closeRaw, row.flips90d),
    sideText('周线', row.weekly, null),
  ].join('\n')
}

function changeText(hit: WhaleSymbolHolding): string {
  if (hit.change == null) return '没有上一期可比'
  if (hit.change === 'new') return '本期新建仓'
  if (hit.change === 'unchanged') return '较上期股数不变'
  if (hit.change === 'closed') return `上期 ${shares(hit.prevShares ?? 0)} 股，本期已清仓`
  const from = hit.prevShares == null ? '' : `${shares(hit.prevShares)} → `
  const verb = hit.change === 'increased' ? '加仓' : '减仓'
  return `较上期${verb}，股数 ${from}${shares(hit.shares)}`
}

function securityPrefix(hit: WhaleSymbolHolding): string {
  if (hit.putCall === 'Call') return '认购期权，'
  if (hit.putCall === 'Put') return '认沽期权，'
  if (hit.shareType.trim().toUpperCase() === 'PRN') return '本金，'
  return ''
}

function holdingText(hit: WhaleSymbolHolding): string {
  const value = hit.valueLabel ?? (hit.closed ? usd(hit.prevValueUsd ?? 0) : usd(hit.valueUsd))
  const weight = hit.weight == null ? '' : `，占组合 ${(hit.weight * 100).toFixed(1)}%`
  const position = hit.closed
    ? `上期市值 ${value}`
    : `持有 ${shares(hit.shares)} 股，市值 ${value}${weight}`
  const url = `${siteOrigin()}/whales/${encodeURIComponent(hit.slug)}`
  return `名家：${hit.manager}（${hit.nameZh}），报告期 ${hit.reportPeriod}，${securityPrefix(hit)}${position}，${changeText(hit)}。${url}`
}

function whaleText(symbol: string, hits: WhaleSymbolHolding[]): string {
  const mine = hits.filter(hit => hit.ticker.toUpperCase() === symbol.toUpperCase())
  if (mine.length === 0) return '名家持仓：已追踪机构的最新一期没有这只，本期也没有清仓。'
  return mine.map(holdingText).join('\n')
}

/** 给 /chat/stream 贴在文档参考后面。功能关闭时明确写未开启，避免模型用研报里的话补。 */
export function marketAppendixForMarkdown(markdown: string): string {
  const symbols = extractTickersFromTitles(titlesInMarkdown(markdown)).map(ticker => ticker.symbol)
  if (symbols.length === 0) {
    return `${HEADER}\n这篇研报的标题里没有美股或港股代码，没有可对照的信号或名家持仓。`
  }
  const lines = [
    HEADER,
    `对照这篇研报标题里的代码：${symbols.join('、')}。下面不是研报原文。`,
    `信号页：${siteOrigin()}/signals`,
  ]
  const signalsOn = isSignalsEnabled()
  const whalesOn = isWhalesEnabled()
  if (!signalsOn) lines.push('信号未开启。')
  if (!whalesOn) lines.push('名家持仓未开启。')
  const holdings = whalesOn ? holdingsForTickers(symbols) : []
  const rows = signalsOn ? signalBoard() : []
  for (const symbol of symbols) {
    lines.push('', symbol)
    if (signalsOn) lines.push(signalText(symbol, rows))
    if (whalesOn) lines.push(whaleText(symbol, holdings))
  }
  return lines.join('\n')
}
