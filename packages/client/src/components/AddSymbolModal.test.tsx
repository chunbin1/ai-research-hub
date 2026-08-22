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

const noop = async () => true

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

test('确认添加把探测到的 symbol 与 market 交回去', async () => {
  stubProbe(() => ({ body: RKLB }))
  const onConfirm = vi.fn(async () => true)
  render(<AddSymbolModal open onCancel={() => {}} onConfirm={onConfirm} />)

  await userEvent.type(screen.getByLabelText('代码'), ' nasdaq: rklb ')
  await userEvent.click(screen.getByRole('button', { name: '查询' }))
  await waitFor(() => expect(confirmBtn().disabled).toBe(false))
  await userEvent.click(screen.getByRole('button', { name: /确认添加/ }))

  // 交回去的是**探测结果里归一化后的** symbol,不是用户输入的原始串
  expect(onConfirm).toHaveBeenCalledWith('RKLB', 'US')
})
