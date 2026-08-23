import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddSymbolModal } from './AddSymbolModal'

const RKLB = {
  symbol: 'RKLB', market: 'US', name: 'Rocket Lab Corporation', currency: 'USD',
  exchange: 'NasdaqGS', bars: 1218, enough: true, alreadyListed: false, deleted: false,
}

function stubProbe(impl: (code: string) => { ok?: boolean; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
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

  await userEvent.type(screen.getByLabelText('代码'), 'RKLB')
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

  await userEvent.type(screen.getByLabelText('代码'), 'SPCX')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/历史仅 49 根/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(false)
})

test('已在自选股中时不能添加', async () => {
  stubProbe(() => ({ body: { ...RKLB, alreadyListed: true } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/已在自选股中/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(true)
})

test('曾被删除的提示将恢复', async () => {
  stubProbe(() => ({ body: { ...RKLB, deleted: true } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/将恢复该标的/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(false)
})

test('查询失败显示服务端文案,确认仍禁用', async () => {
  stubProbe(() => ({ ok: false, body: { error: 'unsupported_market', message: '只支持美股与港股' } }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  await userEvent.type(screen.getByLabelText('代码'), '002466')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))

  await waitFor(() => expect(screen.getByText(/只支持美股与港股/)).toBeTruthy())
  expect(confirmBtn().disabled).toBe(true)
})

test('改动代码后要重新查询 —— 旧的探测结果作废', async () => {
  // 否则会出现「查的是 RKLB、加进去的是别的代码」这种最坏情况
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码')
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
  vi.stubGlobal('fetch', vi.fn(async () => {
    await gate
    return { ok: true, json: async () => RKLB } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码')
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
  vi.stubGlobal('fetch', vi.fn(async () => {
    await gate
    return { ok: true, json: async () => RKLB } as Response
  }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)

  const input = screen.getByLabelText('代码')
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
  await userEvent.type(screen.getByLabelText('代码'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(screen.getByText('Rocket Lab Corporation')).toBeTruthy())

  await userEvent.click(screen.getByRole('button', { name: '取消' }))
  rerender(<AddSymbolModal open onCancel={() => {}} onConfirm={noop} />)
  expect((screen.getByLabelText('代码') as HTMLInputElement).value).toBe('')
  expect(screen.queryByText('Rocket Lab Corporation')).toBeNull()
  expect(confirmBtn().disabled).toBe(true)
})

test('添加失败时错误显示在弹窗里,弹窗不关闭', async () => {
  // 页面自己的错误横幅在弹窗遮罩后面,看不见 —— 所以必须在弹窗内显示
  stubProbe(() => ({ body: RKLB }))
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={async () => 'RKLB 已在自选股中'} />)

  await userEvent.type(screen.getByLabelText('代码'), 'RKLB')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  await userEvent.click(confirmBtn())

  await waitFor(() => expect(screen.getByText('RKLB 已在自选股中')).toBeTruthy())
})

test('确认添加把探测到的 symbol 与 market 交回去', async () => {
  stubProbe(() => ({ body: RKLB }))
  const onConfirm = vi.fn(async () => null)
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={onConfirm} />)

  await userEvent.type(screen.getByLabelText('代码'), ' nasdaq: rklb ')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  await userEvent.click(screen.getByRole('button', { name: /确认添加/ }))

  // 交回去的是**探测结果里归一化后的** symbol,不是用户输入的原始串
  expect(onConfirm).toHaveBeenCalledWith('RKLB', 'US')
})
