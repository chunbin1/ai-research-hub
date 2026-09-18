import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddSymbolModal } from './AddSymbolModal'

const RKLB = {
  symbol: 'RKLB', market: 'US', name: 'Rocket Lab Corporation', currency: 'USD',
  exchange: 'NasdaqGS', bars: 1218, enough: true, alreadyListed: false, deleted: false,
}

function stubProbe(impl: (code: string) => { ok?: boolean; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    // 模糊搜索 GET —— 默认空候选,具体用例再覆盖
    if (String(url).includes('/watchlist/search')) {
      return { ok: true, json: async () => ({ results: [] }) } as Response
    }
    const { ok = true, body } = impl(JSON.parse(String(init?.body ?? '{}')).code)
    return { ok, json: async () => body } as Response
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

const noop = async () => null

// 仓库没装 @testing-library/jest-dom,没有 toBeDisabled 这类 matcher ——
// antd 禁用时渲染的就是原生 <button disabled>,直接读属性即可。
const confirmBtn = () => screen.getByRole('button', { name: /确认添加/ }) as HTMLButtonElement

test('查询成功前「确认添加」是禁用的', async () => {
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)
  expect(confirmBtn().disabled).toBe(true)
})

test('查询后展示公司身份,确认按钮解禁', async () => {
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText('Rocket Lab Corporation')).toBeTruthy())
  expect(screen.getByText(/NasdaqGS/)).toBeTruthy()
  expect(screen.getByText(/1218/)).toBeTruthy()
  expect(confirmBtn().disabled).toBe(false)
})

test('历史不足时提示但仍可添加', async () => {
  // SPCX 2026-06-12 才上市,只有 49 根。应该能加,只是暂时不出信号。
  stubProbe(() => ({ body: { ...RKLB, symbol: 'SPCX', name: 'Space Exploration Technologies Corp.', bars: 49, enough: false } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'SPCX')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/历史仅 49 根/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(false)
})

test('已在自选股中时不能添加', async () => {
  stubProbe(() => ({ body: { ...RKLB, alreadyListed: true } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/已在自选股中/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(true)
})

test('曾被删除的提示将恢复', async () => {
  stubProbe(() => ({ body: { ...RKLB, deleted: true } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/将恢复该标的/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(false)
})

test('查询失败显示服务端文案,确认仍禁用', async () => {
  stubProbe(() => ({ ok: false, body: { error: 'unsupported_market', message: '只支持美股与港股' } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), '002466')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/只支持美股与港股/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(true)
})

test('改动代码后要重新查询 —— 旧的探测结果作废', async () => {
  // 否则会出现「查的是 RKLB、加进去的是别的代码」这种最坏情况
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码或公司名')
  await userEvent.type(input, 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))

  await userEvent.type(input, 'X')
  expect(confirmBtn().disabled).toBe(true)
  expect(screen.queryByText('Rocket Lab Corporation')).toBeNull()
})

test('查询飞行途中改代码:旧结果回来也不能生效', async () => {
  // 只清 state 挡不住已经发出的请求 —— 它回来时照样 setResult,
  // 于是输入框显示 RKLBX、面板显示 Rocket Lab、确认按钮还亮着,
  // 用户以为在加 RKLBX,实际加的是 RKLB。
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/watchlist/search')) {
      return { ok: true, json: async () => ({ results: [] }) } as Response
    }
    await gate
    return { ok: true, json: async () => RKLB } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码或公司名')
  await userEvent.type(input, 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await userEvent.type(input, 'X')          // 请求还在飞的时候改了代码

  release()
  await new Promise(r => setTimeout(r, 0))
  expect(confirmBtn().disabled).toBe(true)
  expect(screen.queryByText('Rocket Lab Corporation')).toBeNull()
})

test('查询途中改代码,转圈要停下来 —— 否则查询按钮永远点不动', async () => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/watchlist/search')) {
      return { ok: true, json: async () => ({ results: [] }) } as Response
    }
    await gate
    return { ok: true, json: async () => RKLB } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码或公司名')
  await userEvent.type(input, 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await userEvent.type(input, 'X')

  // 用正则而非精确字符串定位:loading 图标退场动画期间,antd 的 Spin
  // 图标仍带着 aria-label="loading" 留在 DOM 里一拍,会把可访问名暂时
  // 变成 "loading 查询"。这只是退场动画的残留,不代表按钮真的还在转圈 ——
  // 真正反映 `loading` prop 的是 antd 内部维护的 ant-btn-loading class,
  // 它在 setProbing(false) 生效的同一渲染里就已经被摘掉,所以下面仍然
  // 断言这个 class,只是查找按钮时放宽成子串匹配。
  const probeBtn = screen.getByRole('button', { name: /查询/ }) as HTMLButtonElement
  expect(probeBtn.classList.contains('ant-btn-loading')).toBe(false)

  release()
  await new Promise(r => setTimeout(r, 0))
  expect((screen.getByRole('button', { name: /查询/ }) as HTMLButtonElement)
    .classList.contains('ant-btn-loading')).toBe(false)
})

test('关掉再打开是干净的,不留上一次的结果', async () => {
  stubProbe(() => ({ body: RKLB }))
  const { rerender } = render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)
  await userEvent.type(screen.getByLabelText('代码或公司名'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(screen.getByText('Rocket Lab Corporation')).toBeTruthy())

  await userEvent.click(screen.getByRole('button', { name: '取消' }))
  rerender(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)
  expect((screen.getByLabelText('代码或公司名') as HTMLInputElement).value).toBe('')
  expect(screen.queryByText('Rocket Lab Corporation')).toBeNull()
  expect(confirmBtn().disabled).toBe(true)
})

test('添加失败时错误显示在弹窗里,弹窗不关闭', async () => {
  // 页面自己的错误横幅在弹窗遮罩后面,看不见 —— 所以必须在弹窗内显示
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={async () => 'RKLB 已在自选股中'} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  await userEvent.click(confirmBtn())

  await waitFor(() => expect(screen.getByText('RKLB 已在自选股中')).toBeTruthy())
})

test('确认添加把探测到的 symbol 与 market 交回去', async () => {
  stubProbe(() => ({ body: RKLB }))
  const onConfirm = vi.fn(async () => null)
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={onConfirm} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), ' nasdaq: rklb ')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  await userEvent.click(screen.getByRole('button', { name: /确认添加/ }))

  // 交回去的是**探测结果里归一化后的** symbol,不是用户输入的原始串
  expect(onConfirm).toHaveBeenCalledWith('RKLB', 'US')
})


const MEITU_HITS = [
  { symbol: '3690.HK', name: 'Meituan', market: 'HK', exchange: 'Hong Kong' },
  { symbol: '1357.HK', name: 'Meitu, Inc.', market: 'HK', exchange: 'Hong Kong' },
]

test('输入公司名后出现模糊候选,点选后走 probe 确认', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/watchlist/search')) {
      return { ok: true, json: async () => ({ results: MEITU_HITS }) } as Response
    }
    const code = JSON.parse(String(init?.body ?? '{}')).code
    expect(code).toBe('3690.HK')
    return { ok: true, json: async () => ({
      symbol: '3690.HK', market: 'HK', name: 'Meituan', currency: 'HKD',
      exchange: 'HKSE', bars: 1218, enough: true, alreadyListed: false, deleted: false,
    }) } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'meitu')
  await vi.advanceTimersByTimeAsync(350)
  await waitFor(() => expect(screen.getByLabelText('搜索候选')).toBeTruthy())
  expect(screen.getByText('3690.HK')).toBeTruthy()
  expect(screen.getByText('Meituan')).toBeTruthy()
  expect(confirmBtn().disabled).toBe(true)   // 点选前仍须 probe

  await userEvent.click(screen.getByRole('button', { name: /选择 3690\.HK/ }))
  await waitFor(() => expect(screen.getByText('Meituan')).toBeTruthy())
  // Descriptions 里的公司名 + probe 成功后确认按钮解禁
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  expect(screen.queryByLabelText('搜索候选')).toBeNull()
  vi.useRealTimers()
})

test('过期的搜索结果不能覆盖更新后的候选', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let releaseSlow!: () => void
  const slow = new Promise<void>(r => { releaseSlow = r })
  let searchCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!String(url).includes('/watchlist/search')) {
      return { ok: true, json: async () => RKLB } as Response
    }
    searchCalls++
    if (searchCalls === 1) {
      await slow
      return { ok: true, json: async () => ({ results: MEITU_HITS }) } as Response
    }
    return { ok: true, json: async () => ({ results: [
      { symbol: 'ALB', name: 'Albemarle Corporation', market: 'US', exchange: 'NYSE' },
    ] }) } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码或公司名'), 'mei')
  await vi.advanceTimersByTimeAsync(350)
  // 第一次搜索还在飞,改成 alb
  await userEvent.clear(screen.getByLabelText('代码或公司名'))
  await userEvent.type(screen.getByLabelText('代码或公司名'), 'alb')
  await vi.advanceTimersByTimeAsync(350)
  releaseSlow()
  await waitFor(() => expect(screen.getByText('ALB')).toBeTruthy())
  expect(screen.queryByText('3690.HK')).toBeNull()
  vi.useRealTimers()
})

test('Enter / 查询 精确探测路径仍然可用', async () => {
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)
  const input = screen.getByLabelText('代码或公司名')
  await userEvent.type(input, 'RKLB{Enter}')
  await waitFor(() => expect(screen.getByText('Rocket Lab Corporation')).toBeTruthy())
  expect(confirmBtn().disabled).toBe(false)
})
