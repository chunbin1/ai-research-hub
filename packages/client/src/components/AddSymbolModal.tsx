import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Input, Modal, Space, Typography } from 'antd'
import { api } from '../api'
import type { ProbeResult, SymbolSearchHit } from '../types'

interface Props {
  open: boolean
  onCancel: () => void
  /** 成功返回 null;失败返回中文错误文案,由弹窗自己显示出来 */
  onConfirm: (symbol: string, market: 'US' | 'HK') => Promise<string | null>
}

const SEARCH_DEBOUNCE_MS = 300

/**
 * 两步式:先查询确认公司身份,再添加。
 *
 * 为什么不能一步到位:`HBM` 在 Yahoo 上是加拿大铜矿 Hudbay Minerals ——
 * 代码合法、探测成功、扫描也正常,只是公司不对。这类错只有把公司全名
 * 摆到人眼前才挡得住,所以查询成功前「确认添加」必须是禁用的。
 *
 * 模糊搜索只负责给候选名单(公司名 / 代码子串都能命中);点选之后仍然走
 * 原来的 probe 确认 —— 搜索不能替代身份确认。
 */
export function AddSymbolModal({ open, onCancel, onConfirm }: Props) {
  const [code, setCode] = useState('')
  const [probing, setProbing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<SymbolSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchEmpty, setSearchEmpty] = useState(false)
  // 每次「查询」和每次改动代码都自增。回调里比对它,就能把过期的那次请求整个丢掉。
  const reqId = useRef(0)
  // 搜索与探测各自一套序号 —— 点「查询」不该把还在飞的搜索结果误当成最新。
  const searchReqId = useRef(0)
  // 点选候选时会主动改 code 并立刻 probe;那一次不该再触发防抖搜索。
  // 记 symbol 而非布尔:同名点选时 React 对相同 setState bail-out,effect 不跑,
  // 布尔标志会卡死并吞掉下一次真正改动后的搜索。
  const skipSearchFor = useRef<string | null>(null)
  // doProbe 会绕过 effect cleanup,必须能主动清掉排队中的防抖计时器。
  const searchTimer = useRef<number | null>(null)

  const clearSearchTimer = () => {
    if (searchTimer.current != null) {
      window.clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
  }

  // 清空上一次探测的一切痕迹。**必须连 probing 一起清** —— 若此刻正有一个请求在飞,
  // 它的 finally 会因为 reqId 已经变了而跳过 setProbing(false),转圈就再也停不下来。
  const clearProbe = () => { setResult(null); setError(null); setProbing(false) }

  const clearSearch = () => {
    setCandidates([])
    setSearching(false)
    setSearchError(null)
    setSearchEmpty(false)
  }

  const reset = () => {
    reqId.current++
    searchReqId.current++
    skipSearchFor.current = null
    clearSearchTimer()
    setCode('')
    clearProbe()
    clearSearch()
  }

  // 代码一改,上一次的探测结果立刻作废 —— 否则会出现
  // 「查的是 RKLB、加进去的是别的代码」这种最坏情况。
  // 自增 reqId 是为了连**正在飞的那次请求**也一起作废:只清 state 挡不住它,
  // 它回来时照样会 setResult,让输入框显示 RKLBX、面板显示 Rocket Lab、按钮还亮着。
  const onCodeChange = (v: string) => {
    reqId.current++
    searchReqId.current++
    setCode(v)
    clearProbe()
    clearSearch()
  }

  // 防抖模糊搜索。空串不打网络;点选候选触发的那次 setCode 用 skipSearchFor 跳过。
  useEffect(() => {
    // 关弹窗时必须清 skip 标志,否则会泄漏到下次打开。
    // 比对也要在 !open 分支之前/之中处理,不能被 early return 挡住。
    if (!open) {
      skipSearchFor.current = null
      clearSearchTimer()
      return
    }
    if (skipSearchFor.current !== null && code === skipSearchFor.current) {
      skipSearchFor.current = null
      return
    }
    skipSearchFor.current = null
    const q = code.trim()
    if (!q) {
      clearSearch()
      return
    }
    const myId = ++searchReqId.current
    clearSearchTimer()
    searchTimer.current = window.setTimeout(() => {
      searchTimer.current = null
      void (async () => {
        // 计时器到点时若已被 doProbe 作废,连 searching 都不要置 true
        if (myId !== searchReqId.current) return
        setSearching(true)
        setSearchError(null)
        setSearchEmpty(false)
        try {
          const results = await api.searchSymbols(q)
          if (myId !== searchReqId.current) return
          setCandidates(results)
          setSearchEmpty(results.length === 0)
        } catch (err) {
          // 搜索失败不挡「查询」主路径 —— 在候选区显示灰字,不弹 Alert
          if (myId !== searchReqId.current) return
          setCandidates([])
          setSearchEmpty(false)
          setSearchError(err instanceof Error ? err.message : '搜索失败')
        } finally {
          if (myId === searchReqId.current) setSearching(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)
    return () => { clearSearchTimer() }
  }, [code, open])

  /** @param override 点选候选时 state 里的 code 可能还没 flush,用显式值探测 */
  const doProbe = async (override?: string) => {
    const raw = (override ?? code).trim()
    if (!raw) return
    const myId = ++reqId.current
    searchReqId.current++          // 探测开始后丢弃还在飞的搜索
    clearSearchTimer()             // 连排队中的防抖也清掉,否则仍会白打一次 Yahoo
    setProbing(true); setError(null); setResult(null); clearSearch()
    try {
      const r = await api.probeSymbol(raw)
      if (myId !== reqId.current) return
      setResult(r)
    } catch (err) {
      if (myId !== reqId.current) return
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      if (myId === reqId.current) setProbing(false)
    }
  }

  const pickCandidate = (hit: SymbolSearchHit) => {
    skipSearchFor.current = hit.symbol
    reqId.current++
    searchReqId.current++
    clearSearchTimer()
    setCode(hit.symbol)
    clearProbe()
    clearSearch()
    void doProbe(hit.symbol)
  }

  const doConfirm = async () => {
    if (!result) return
    setAdding(true)
    try {
      const msg = await onConfirm(result.symbol, result.market)
      if (msg) { setError(msg); return }   // 错误要显示在弹窗里 —— 页面横幅被遮罩挡住了
      reset(); onCancel()
    } finally { setAdding(false) }
  }

  const canAdd = !!result && !result.alreadyListed
  const showCandidates = candidates.length > 0 && !result && !probing
  const showSearchHint = !result && !probing && !searching && (searchError != null || searchEmpty)

  return (
    <Modal
      open={open}
      title="添加标的"
      onCancel={() => { reset(); onCancel() }}
      footer={[
        <Button key="cancel" onClick={() => { reset(); onCancel() }} autoInsertSpace={false}>取消</Button>,
        <Button key="ok" type="primary" disabled={!canAdd} loading={adding} onClick={() => void doConfirm()}>
          确认添加
        </Button>,
      ]}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            aria-label="代码或公司名"
            placeholder="代码、公司名,如 meitu / ALB / 9988"
            value={code}
            onChange={e => onCodeChange(e.target.value)}
            onPressEnter={() => void doProbe()}
            autoComplete="off"
          />
          <Button onClick={() => void doProbe()} loading={probing} disabled={!code.trim()} autoInsertSpace={false}>
            查询
          </Button>
        </Space.Compact>

        {searching && !showCandidates && !result && !error && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>搜索中…</Typography.Text>
        )}

        {showCandidates && (
          <ul
            aria-label="搜索候选"
            style={{
              listStyle: 'none', margin: 0, padding: 0,
              border: '1px solid #E1DED7', maxHeight: 220, overflowY: 'auto',
            }}
          >
            {candidates.map(hit => (
              <li key={hit.symbol} style={{ borderBottom: '1px solid #EFECE6' }}>
                <button
                  type="button"
                  aria-label={`选择 ${hit.symbol}${hit.name ? ` ${hit.name}` : ''}`}
                  onClick={() => pickCandidate(hit)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'baseline', gap: 12,
                    padding: '8px 12px', border: 0, background: 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 72 }}>{hit.symbol}</span>
                  <span style={{ flex: 1, color: '#8A857A', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hit.name ?? ''}
                  </span>
                  <span style={{ color: '#8A857A', fontSize: 11, flexShrink: 0 }}>
                    {hit.market === 'US' ? '美股' : '港股'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showSearchHint && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {searchError ?? '没有匹配的标的'}
          </Typography.Text>
        )}

        {error && <Alert type="error" title={error} showIcon />}

        {result && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="公司">
                <Typography.Text strong>{result.name ?? '(未知)'}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="代码">
                {result.symbol} · {result.exchange ?? (result.market === 'US' ? '美股' : '港股')} · {result.currency ?? ''}
              </Descriptions.Item>
              <Descriptions.Item label="历史">{result.bars} 根日线</Descriptions.Item>
            </Descriptions>

            {result.alreadyListed && <Alert type="warning" title={`${result.symbol} 已在自选股中`} showIcon />}
            {result.deleted && <Alert type="info" title="该标的曾被删除,添加将恢复该标的(历史需重新扫描)" showIcon />}
            {!result.enough && (
              <Alert
                type="warning"
                showIcon
                title={`历史仅 ${result.bars} 根,不足 120 根`}
                description="可以添加,但暂时不会出信号 —— SuperTrend 预热不足时给出的方向是错的。"
              />
            )}
          </>
        )}
      </Space>
    </Modal>
  )
}
