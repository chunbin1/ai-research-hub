import { useRef, useState } from 'react'
import { Alert, Button, Descriptions, Input, Modal, Space, Typography } from 'antd'
import { api } from '../api'
import type { ProbeResult } from '../types'

interface Props {
  open: boolean
  onCancel: () => void
  /** 返回 true 表示添加成功,弹窗自行关闭并复位 */
  onConfirm: (symbol: string, market: 'US' | 'HK') => Promise<boolean>
}

/**
 * 两步式:先查询确认公司身份,再添加。
 *
 * 为什么不能一步到位:`HBM` 在 Yahoo 上是加拿大铜矿 Hudbay Minerals ——
 * 代码合法、探测成功、扫描也正常,只是公司不对。这类错只有把公司全名
 * 摆到人眼前才挡得住,所以查询成功前「确认添加」必须是禁用的。
 */
export function AddSymbolModal({ open, onCancel, onConfirm }: Props) {
  const [code, setCode] = useState('')
  const [probing, setProbing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 每次「查询」和每次改动代码都自增。回调里比对它,就能把过期的那次请求整个丢掉。
  const reqId = useRef(0)

  const reset = () => { reqId.current++; setCode(''); setResult(null); setError(null) }

  // 代码一改,上一次的探测结果立刻作废 —— 否则会出现
  // 「查的是 RKLB、加进去的是别的代码」这种最坏情况。
  // 自增 reqId 是为了连**正在飞的那次请求**也一起作废:只清 state 挡不住它,
  // 它回来时照样会 setResult,让输入框显示 RKLBX、面板显示 Rocket Lab、按钮还亮着。
  const onCodeChange = (v: string) => { reqId.current++; setCode(v); setResult(null); setError(null) }

  const doProbe = async () => {
    const myId = ++reqId.current
    setProbing(true); setError(null); setResult(null)
    try {
      const r = await api.probeSymbol(code)
      if (myId !== reqId.current) return      // 期间代码被改过,这次结果作废
      setResult(r)
    } catch (err) {
      if (myId !== reqId.current) return
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      if (myId === reqId.current) setProbing(false)
    }
  }

  const doConfirm = async () => {
    if (!result) return
    setAdding(true)
    try {
      if (await onConfirm(result.symbol, result.market)) { reset(); onCancel() }
    } finally { setAdding(false) }
  }

  const canAdd = !!result && !result.alreadyListed

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
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space.Compact style={{ width: '100%' }}>
          <Input
            aria-label="代码"
            placeholder="如 RKLB、NASDAQ: RKLB、0700.HK"
            value={code}
            onChange={e => onCodeChange(e.target.value)}
            onPressEnter={() => void doProbe()}
          />
          <Button onClick={() => void doProbe()} loading={probing} disabled={!code.trim()} autoInsertSpace={false}>
            查询
          </Button>
        </Space.Compact>

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
