import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { formatUsd, securityTitle, type WhaleSummary } from '../lib/whaleView'

const GUTTER = 'px-[18px] md:px-7 lg:px-10'

interface AddFields {
  cik: string
  manager: string
  nameZh: string
  nameEn: string
  slug: string
}

const EMPTY_FORM: AddFields = { cik: '', manager: '', nameZh: '', nameEn: '', slug: '' }

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function tabbableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(el => el.tabIndex >= 0)
}

export default function WhalesPage() {
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const [institutions, setInstitutions] = useState<WhaleSummary[] | null>(null)
  const [valueNote, setValueNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<AddFields>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const cikInputRef = useRef<HTMLInputElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  savingRef.current = saving

  function closeForm() {
    if (savingRef.current) return
    setFormOpen(false)
    setFormError(null)
    setForm(EMPTY_FORM)
  }

  const load = useCallback((cancelled?: () => boolean) => {
    void fetch('/api/whales')
      .then(async response => {
        if (cancelled?.()) return
        if (response.status === 404) {
          const body = await response.json().catch(() => null) as { error?: string } | null
          if (body?.error === 'whales_disabled') {
            setError('名家持仓已关闭')
            setLoading(false)
            return
          }
        }
        if (!response.ok) {
          setError('名家持仓加载失败')
          setLoading(false)
          return
        }
        const body = await response.json() as { institutions: WhaleSummary[]; valueNote?: string }
        setInstitutions(body.institutions)
        setValueNote(body.valueNote ?? '')
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled?.()) {
          setError('名家持仓加载失败')
          setLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    let stopped = false
    load(() => stopped)
    return () => { stopped = true }
  }, [load])

  useEffect(() => {
    if (!formOpen) return
    const previousOverflow = document.body.style.overflow
    // html 已用 scrollbar-gutter 留出滚动槽。这里只藏滚动，不改 body 宽度，
    // 避免和 antd 弹窗的宽度补偿叠在一起，开合时整页横向抖一下。
    document.body.style.overflow = 'hidden'
    cikInputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeForm()
        return
      }
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = tabbableIn(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      const inside = active instanceof Node && root.contains(active)
      if (!inside) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (addButtonRef.current?.isConnected) addButtonRef.current.focus()
    }
  }, [formOpen])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const response = await fetch('/api/whales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cik: form.cik,
          manager: form.manager,
          nameZh: form.nameZh,
          nameEn: form.nameEn,
          slug: form.slug,
        }),
      })
      const body = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) {
        setFormError(body?.message || '添加失败')
        return
      }
      setForm(EMPTY_FORM)
      setFormOpen(false)
      load()
    } catch {
      setFormError('添加失败')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(row: WhaleSummary) {
    if (!window.confirm(`确定删除 ${row.manager}？申报和持仓会一并清掉。六家种子会在下次重启时写回。`)) return
    setDeleteError(null)
    try {
      const response = await fetch(`/api/whales/${encodeURIComponent(row.slug)}`, { method: 'DELETE' })
      if (!response.ok) {
        setDeleteError('删除失败')
        return
      }
      load()
    } catch {
      setDeleteError('删除失败')
    }
  }

  if (loading) {
    return <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-ink-mute ${GUTTER}`}>加载中…</div>
  }
  if (error) {
    return <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-danger ${GUTTER}`}>{error}</div>
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      <div className={`flex flex-col gap-3.5 border-b border-rule pb-4 pt-3.5 md:flex-row md:items-end md:justify-between md:gap-10 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[26px]">名家持仓</h1>
          <p className="m-0 max-w-[640px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px] md:leading-[1.6]">
            美国 SEC Form 13F 的公开申报。
          </p>
        </div>
        {isAdmin && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => { setForm(EMPTY_FORM); setFormError(null); setFormOpen(true) }}
            className="flex h-11 shrink-0 items-center justify-center rounded-[4px] border border-edge bg-white px-[15px] text-[13px] text-ink-soft hover:border-ink-faint"
          >
            添加机构
          </button>
        )}
      </div>
      {deleteError && (
        <p role="alert" className={`m-0 border-b border-rule py-3 text-[13px] text-danger ${GUTTER}`}>{deleteError}</p>
      )}
      {isAdmin && formOpen && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(20,22,26,0.45)] p-4 md:items-center"
          onMouseDown={() => closeForm()}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="whale-add-title"
            className="w-full max-w-[520px] rounded-[8px] border border-edge bg-page p-5 shadow-[0_12px_40px_rgba(20,22,26,0.18)]"
            onMouseDown={event => event.stopPropagation()}
          >
            <h2 id="whale-add-title" className="m-0 font-serif-sc text-[18px] font-semibold text-ink">添加机构</h2>
            <form onSubmit={event => void onAdd(event)} className="mt-4 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  CIK
                  <input ref={cikInputRef} required value={form.cik} onChange={event => setForm(current => ({ ...current, cik: event.target.value }))} className="h-10 rounded-[4px] border border-edge bg-white px-3 font-sans-sc text-[14px] text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  管理人
                  <input required value={form.manager} onChange={event => setForm(current => ({ ...current, manager: event.target.value }))} className="h-10 rounded-[4px] border border-edge bg-white px-3 text-[14px] text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  中文名
                  <input required value={form.nameZh} onChange={event => setForm(current => ({ ...current, nameZh: event.target.value }))} className="h-10 rounded-[4px] border border-edge bg-white px-3 text-[14px] text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  英文名
                  <input value={form.nameEn} onChange={event => setForm(current => ({ ...current, nameEn: event.target.value }))} className="h-10 rounded-[4px] border border-edge bg-white px-3 text-[14px] text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute sm:col-span-2">
                  短名
                  <input value={form.slug} placeholder="不填则从英文名生成" onChange={event => setForm(current => ({ ...current, slug: event.target.value }))} className="h-10 rounded-[4px] border border-edge bg-white px-3 text-[14px] text-ink" />
                </label>
              </div>
              {formError && <p role="alert" className="m-0 text-[13px] text-danger">{formError}</p>}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" disabled={saving} onClick={closeForm} className="h-10 rounded-[4px] border border-edge bg-white px-4 text-[13px] text-ink-soft disabled:opacity-60">
                  取消
                </button>
                <button type="submit" disabled={saving} className="h-10 rounded-[4px] bg-ink px-4 text-[13px] text-page disabled:opacity-60">
                  {saving ? '添加中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <main className={`flex-1 ${GUTTER}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-t border-ink text-left">
            <thead>
              <tr className="border-b border-rule text-[12px] tracking-[0.02em] text-ink-mute">
                <th scope="col" className="py-3 pr-3 font-normal">管理人</th>
                <th scope="col" className="py-3 pr-3 font-normal">机构</th>
                <th scope="col" className="py-3 pr-3 font-normal">报告期</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">持仓数</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">市值合计（美元）</th>
                <th scope="col" className="py-3 pr-3 font-normal">第一大持仓</th>
                <th scope="col" className="py-3 pr-3 font-normal">状态</th>
                {isAdmin && <th scope="col" className="py-3 text-right font-normal">操作</th>}
              </tr>
            </thead>
            <tbody>
              {(institutions ?? []).map(row => (
                <tr key={row.slug} className="border-b border-row-rule">
                  <td className="py-4 pr-3">
                    <Link to={`/whales/${row.slug}`} className="text-[15px] font-medium text-ink hover:text-brick">
                      {row.manager}
                    </Link>
                  </td>
                  <td className="py-4 pr-3 text-[13px] text-ink-soft">{row.nameZh}</td>
                  <td className="py-4 pr-3 font-sans-sc text-[14px] tabular-nums text-ink">
                    {row.latest ? <time dateTime={row.latest.reportPeriod}>{row.latest.reportPeriod}</time> : '—'}
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    {row.latest ? row.latest.positionCount : '—'}
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    {row.latest ? formatUsd(row.latest.totalValueUsd) : '—'}
                  </td>
                  <td className="py-4 pr-3 text-[13px] text-ink">
                    {row.latest?.top ? securityTitle(row.latest.top) : '—'}
                  </td>
                  <td className="py-4 pr-3 text-[13px]">
                    {row.dataStatus === 'empty' ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-ink-mute">暂无数据</span>
                        {row.syncError && <span className="text-[12px] text-ink-faint">最近一次拉取失败</span>}
                      </div>
                    ) : (
                      <span className="text-ink-soft">{row.latest?.form}</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="py-4 text-right">
                      <button type="button" className="text-[13px] text-danger" aria-label={`删除 ${row.manager}`} onClick={() => void onDelete(row)}>
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <footer className={`mt-5 border-t border-rule pb-7 pt-4 text-[11px] leading-[1.6] text-ink-faint md:mt-6 md:pt-5 md:text-[12px] ${GUTTER}`}>
        {valueNote || '市值单位为美元。'} 13F 通常在季末后 45 天内申报，只覆盖美国披露范围内的多头。
      </footer>
    </div>
  )
}
