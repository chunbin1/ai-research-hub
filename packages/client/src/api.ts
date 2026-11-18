import type {
  Document,
  DocumentVersion,
  EtfBoardResponse,
  EtfDailyMetric,
  EtfDailySummary,
  EtfMonitorParams,
  EtfTier,
  EtfUniverseEntry,
  ReportKind,
  SimilarReport,
} from './types'

export class EtfMonitorDisabledError extends Error {
  readonly disabled = true as const

  constructor(message = 'ETF 托底监控未启用') {
    super(message)
    this.name = 'EtfMonitorDisabledError'
  }
}

export function isEtfDisabledError(err: unknown): err is EtfMonitorDisabledError {
  return err instanceof Error && (err as { disabled?: unknown }).disabled === true
}

async function parseEtfResponse<T>(r: Response, fallbackMsg: string): Promise<T> {
  const body = await r.json().catch(() => ({})) as { error?: string; message?: string }
  if (r.status === 404 && body.error === 'etf_monitor_disabled') {
    throw new EtfMonitorDisabledError()
  }
  if (!r.ok) {
    throw new Error(body.message ?? body.error ?? fallbackMsg)
  }
  return body as T
}

export async function fetchEtfBoard(date?: string): Promise<EtfBoardResponse> {
  const q = date ? `?date=${encodeURIComponent(date)}` : ''
  const r = await fetch(`/api/etf/board${q}`)
  return parseEtfResponse<EtfBoardResponse>(r, 'ETF 托底看板加载失败')
}

export async function fetchEtfTimeline(days = 90): Promise<EtfDailySummary[]> {
  const r = await fetch(`/api/etf/timeline?days=${days}`)
  const body = await parseEtfResponse<{ days: EtfDailySummary[] }>(r, '时间轴加载失败')
  return body.days
}

export async function fetchEtfCodeHistory(
  code: string,
  days = 60,
): Promise<{ code: string; entry: EtfUniverseEntry; history: EtfDailyMetric[] }> {
  const r = await fetch(`/api/etf/${encodeURIComponent(code)}/history?days=${days}`)
  return parseEtfResponse<{ code: string; entry: EtfUniverseEntry; history: EtfDailyMetric[] }>(
    r,
    '单只 ETF 历史加载失败',
  )
}

export async function triggerEtfScan(
  backfillDays?: number,
): Promise<{ total: number; ok: number; failed: number; latestDate: string | null }> {
  const init: RequestInit = { method: 'POST' }
  if (backfillDays !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify({ backfillDays })
  }
  const r = await fetch('/api/etf/scan', init)
  const body = await parseEtfResponse<{
    summary: { total: number; ok: number; failed: number; latestDate: string | null }
  }>(r, 'ETF 扫描失败')
  return body.summary
}

export async function addEtfUniverse(code: string, tier: EtfTier): Promise<EtfUniverseEntry> {
  const r = await fetch('/api/etf/universe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, tier }),
  })
  const body = await parseEtfResponse<{ entry: EtfUniverseEntry }>(r, '添加 ETF 失败')
  return body.entry
}

export async function updateEtfUniverse(
  code: string,
  patch: { enabled?: boolean; tier?: EtfTier },
): Promise<EtfUniverseEntry> {
  const r = await fetch(`/api/etf/universe/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await parseEtfResponse<{ entry: EtfUniverseEntry }>(r, '更新 ETF 失败')
  return body.entry
}

export async function deleteEtfUniverse(code: string): Promise<void> {
  const r = await fetch(`/api/etf/universe/${encodeURIComponent(code)}`, { method: 'DELETE' })
  await parseEtfResponse<{ ok: boolean }>(r, '删除 ETF 失败')
}

export async function updateEtfParams(patch: Partial<EtfMonitorParams>): Promise<EtfMonitorParams> {
  const r = await fetch('/api/etf/params', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = await parseEtfResponse<{ params: EtfMonitorParams }>(r, '更新阈值参数失败')
  return body.params
}

export const api = {
  async listDocuments(): Promise<Document[]> {
    const r = await fetch('/api/documents')
    if (!r.ok) throw new Error('列表加载失败')
    return (await r.json()).documents
  },
  /** 不传 version 就是最新版 */
  async getDocument(id: string, version?: number): Promise<{
    document: Document; markdown: string; version: number; versions: DocumentVersion[]
  }> {
    const q = version === undefined ? '' : `?version=${version}`
    const r = await fetch(`/api/documents/${id}${q}`)
    if (r.status === 404 && version !== undefined) throw new Error(`没有 v${version} 这个版本`)
    if (!r.ok) throw new Error('报告加载失败')
    return r.json()
  },
  async uploadVersion(id: string, file: File, note: string): Promise<DocumentVersion> {
    const fd = new FormData()
    // note 必须在 file 前面:服务端流式解析,只读得到文件之前的字段
    if (note.trim()) fd.append('note', note.trim())
    fd.append('file', file)
    const r = await fetch(`/api/documents/${id}/versions`, { method: 'POST', body: fd })
    if (!r.ok) {
      const body = await r.json().catch(() => ({})) as { error?: string; message?: string }
      throw new Error(body.message ?? body.error ?? '上传失败')
    }
    return (await r.json()).version
  },
  async uploadDocument(file: File, kind?: ReportKind): Promise<Document> {
    const fd = new FormData()
    // kind 必须在 file 前面:服务端流式解析,只读得到文件之前的字段
    if (kind) fd.append('kind', kind)
    fd.append('file', file)
    const r = await fetch('/api/documents', { method: 'POST', body: fd })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? '上传失败')
    return (await r.json()).document
  },
  /**
   * 上传前查重:库里可能是这篇旧版本的研报。只读,不落任何东西。
   * 只在同类之间查:kind 不传就用服务端按标题推断的 suggestedKind(推不出来则不分类)。
   */
  async checkSimilar(file: File, kind?: ReportKind): Promise<{
    title: string; suggestedKind: ReportKind | null; candidates: SimilarReport[]
  }> {
    const fd = new FormData()
    if (kind) fd.append('kind', kind)
    fd.append('file', file)
    const r = await fetch('/api/documents/similar', { method: 'POST', body: fd })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? '查重失败')
    return r.json()
  },
  async setDocumentKind(id: string, kind: ReportKind): Promise<void> {
    const r = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
    if (!r.ok) throw new Error('修改类型失败')
  },
  async deleteDocument(id: string): Promise<void> {
    const r = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('删除失败')
  },
  async getMessages(docId: string): Promise<import('./types').ChatMessage[]> {
    const r = await fetch(`/api/chat/messages?docId=${encodeURIComponent(docId)}`)
    if (!r.ok) return []
    return (await r.json()).messages
  },
  async listSignals(): Promise<import('./types').SignalRow[]> {
    const r = await fetch('/api/signals')
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '看板加载失败')
    return (await r.json()).rows
  },
  async scanSignals(): Promise<import('./types').ScanSummary> {
    const r = await fetch('/api/signals/scan', { method: 'POST' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '扫描失败')
    return (await r.json()).summary
  },
  async extractWatchlist(): Promise<{ documents: number; symbols: string[] }> {
    const r = await fetch('/api/signals/extract', { method: 'POST' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '抽取失败')
    return r.json()
  },
  async searchSymbols(q: string): Promise<import('./types').SymbolSearchHit[]> {
    const r = await fetch(`/api/signals/watchlist/search?q=${encodeURIComponent(q)}`)
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '搜索失败')
    return (await r.json()).results
  },
  async probeSymbol(code: string): Promise<import('./types').ProbeResult> {
    const r = await fetch('/api/signals/watchlist/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '查询失败')
    return r.json()
  },
  async addSymbol(symbol: string, market: 'US' | 'HK'): Promise<void> {
    const r = await fetch('/api/signals/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, market }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '添加失败')
  },
  async deleteSymbol(symbol: string): Promise<void> {
    const r = await fetch(`/api/signals/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '删除失败')
  },
  async getSignalLog(symbol: string, timeframe: '1d' | '1wk', limit = 60): Promise<import('./types').SignalStateRow[]> {
    const r = await fetch(`/api/signals/${encodeURIComponent(symbol)}/log?timeframe=${timeframe}&limit=${limit}`)
    if (!r.ok) throw new Error('日志加载失败')
    return (await r.json()).states
  },
  async listSignalEvents(days = 7): Promise<import('./types').SignalEventRow[]> {
    const r = await fetch(`/api/signals/events?days=${days}`)
    if (!r.ok) throw new Error('事件加载失败')
    return (await r.json()).events
  },
  async getHoldings(): Promise<import('./types').HoldingsSnapshot> {
    const r = await fetch('/api/holdings')
    if (!r.ok) throw new Error('持仓加载失败')
    const body = await r.json() as Partial<import('./types').HoldingsSnapshot> | null
    // 顶栏每个页面都会问这一下。形状不对就当失败,别让坏响应把整站导航拆掉。
    if (!body || !Array.isArray(body.holdings)) throw new Error('持仓加载失败')
    return {
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
      holdings: body.holdings,
    }
  },
  fetchEtfBoard,
  fetchEtfTimeline,
  fetchEtfCodeHistory,
  triggerEtfScan,
  addEtfUniverse,
  updateEtfUniverse,
  deleteEtfUniverse,
  updateEtfParams,
}
