import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TradeDatePicker } from './TradeDatePicker'
import type { EtfDailySummary } from '../types'

const SAMPLE_TIMELINE: EtfDailySummary[] = [
  {
    trade_date: '2026-10-30',
    resonance_level: 'watch',
    active_count: 18,
    volume_spike_count: 2,
    support_etf_count: 1,
    support_tier_count: 1,
    total_amount_yi: 400,
    aggregate_vol_ratio: 1.4,
    total_net_inflow_yi: 15,
    data_stage: 'complete',
    updated_at: '2026-10-30T12:00:00Z',
  },
  {
    trade_date: '2026-11-17',
    resonance_level: 'strong',
    active_count: 18,
    volume_spike_count: 4,
    support_etf_count: 5,
    support_tier_count: 3,
    total_amount_yi: 671.2,
    aggregate_vol_ratio: 1.9,
    total_net_inflow_yi: 129.8,
    data_stage: 'partial_shares',
    updated_at: '2026-11-17T12:00:00Z',
  },
  {
    trade_date: '2026-11-18',
    resonance_level: 'none',
    active_count: 18,
    volume_spike_count: 0,
    support_etf_count: 0,
    support_tier_count: 0,
    total_amount_yi: 310,
    aggregate_vol_ratio: 0.9,
    total_net_inflow_yi: -2,
    data_stage: 'preliminary',
    updated_at: '2026-11-18T12:00:00Z',
  },
]

describe('TradeDatePicker', () => {
  test('opens calendar dialog, disables non-available days, navigates months, and selects a date', async () => {
    const onChange = vi.fn()
    render(
      <TradeDatePicker
        value="2026-11-18"
        availableDates={['2026-11-18', '2026-11-17', '2026-10-30']}
        timeline={SAMPLE_TIMELINE}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('button', { name: '选择历史交易日' })
    expect(trigger.textContent).toContain('2026-11-18')

    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '交易日历' })).toBeTruthy()
    expect(screen.getByText('2026年11月')).toBeTruthy()

    // 2026-11-15（周日无数据）应为禁用
    const disabledBtn = screen.getByRole('button', { name: '2026-11-15' }) as HTMLButtonElement
    expect(disabledBtn.disabled).toBe(true)

    // 切换到上个月 2026年10月 并选中 2026-10-30
    await userEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect(screen.getByText('2026年10月')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '2026-10-30' }))

    expect(onChange).toHaveBeenCalledWith('2026-10-30')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '交易日历' })).toBeNull())
  })

  test('quick jump to latest date and Escape key closes popover', async () => {
    const onChange = vi.fn()
    render(
      <TradeDatePicker
        value="2026-10-30"
        availableDates={['2026-11-18', '2026-11-17', '2026-10-30']}
        timeline={SAMPLE_TIMELINE}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '选择历史交易日' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '交易日历' })).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: '选择历史交易日' }))
    await userEvent.click(screen.getByRole('button', { name: '最新交易日' }))
    expect(onChange).toHaveBeenCalledWith('2026-11-18')
  })
})
