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
  const usesRaw = closeRaw != null
  const close = usesRaw ? closeRaw : side.closeAdj
  const flip = side.flipDate
    ? `最近翻转 ${side.flipDate}（价格 ${num(side.flipPrice)}）`
    : '日志里没有翻转'
  const whip = flips == null ? '' : `，近 90 天翻转 ${flips} 次`
  const closeNote = usesRaw ? '未复权' : '复权'
  return `${label}：${dir}，截至 ${side.barDate}，收盘（${closeNote}）${num(close)}，止损线 ${num(side.stopLine)}，距止损 ${Math.abs(side.distPct).toFixed(1)}%（复权），${flip}${whip}`
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

function isOption(hit: WhaleSymbolHolding): boolean {
  return hit.putCall === 'Call' || hit.putCall === 'Put'
}

/** 众议院普通股经常只有金额区间、股数为 0。这时写「持有 0 股」会误导模型。 */
function omitsShareCount(hit: WhaleSymbolHolding): boolean {
  return hit.shares === 0 && (hit.source === 'house-fd' || !!hit.valueLabel)
}

function shareUnit(hit: WhaleSymbolHolding): string {
  return isOption(hit) ? '份合约' : '股'
}

function changeText(hit: WhaleSymbolHolding): string {
  if (hit.change == null) return '没有上一期可比'
  if (hit.source === 'house-fd') {
    if (hit.change === 'new') return '本期新建仓'
    if (hit.change === 'closed') return '本期已清仓'
    if (hit.change === 'unchanged') return '较上期金额区间不变'
    const verb = hit.change === 'increased' ? '增加' : '减少'
    if (hit.prevValueUsd == null) return `较上期金额${verb}`
    return `较上期金额${verb}，上期约 ${usd(hit.prevValueUsd)}`
  }
  if (hit.change === 'new') return '本期新建仓'
  if (hit.change === 'unchanged') return `较上期${isOption(hit) ? '合约数' : '股数'}不变`
  if (hit.change === 'closed') {
    if (omitsShareCount(hit)) return '本期已清仓'
    return `上期 ${shares(hit.prevShares ?? 0)} ${shareUnit(hit)}，本期已清仓`
  }
  const from = hit.prevShares == null ? '' : `${shares(hit.prevShares)} → `
  const verb = hit.change === 'increased' ? '加仓' : '减仓'
  return `较上期${verb}，${isOption(hit) ? '合约数' : '股数'} ${from}${shares(hit.shares)}`
}

function securityPrefix(hit: WhaleSymbolHolding): string {
  if (hit.putCall === 'Call') return '认购期权，'
  if (hit.putCall === 'Put') return '认沽期权，'
  if (hit.shareType.trim().toUpperCase() === 'PRN') return '本金，'
  return ''
}

function valueText(hit: WhaleSymbolHolding): string {
  if (hit.valueLabel) return `金额区间 ${hit.valueLabel}`
  const amount = hit.closed ? hit.prevValueUsd ?? 0 : hit.valueUsd
  return `市值 ${usd(amount)}`
}

function holdingText(hit: WhaleSymbolHolding): string {
  const weight = hit.weight == null ? '' : `，占组合 ${(hit.weight * 100).toFixed(1)}%`
  const position = hit.closed
    ? `上期${valueText(hit)}`
    : omitsShareCount(hit)
      ? `${valueText(hit)}${weight}`
      : `持有 ${shares(hit.shares)} ${shareUnit(hit)}，${valueText(hit)}${weight}`
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
  // 与 MCP get_signals 一样跳过已删除的自选股。列表本身已经不返回墓碑，这里再滤一次。
  const rows = signalsOn ? signalBoard().filter(row => row.enabled) : []
  for (const symbol of symbols) {
    lines.push('', symbol)
    if (signalsOn) lines.push(signalText(symbol, rows))
    if (whalesOn) lines.push(whaleText(symbol, holdings))
  }
  return lines.join('\n')
}
