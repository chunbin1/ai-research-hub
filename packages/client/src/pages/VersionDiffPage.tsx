import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { SwapOutlined } from '@ant-design/icons'
import { api } from '../api'
import { BackLink } from '../components/BackLink'
import {
  changedSections, diffMarkdown, diffPairFor, diffStats, headingTitle, segment, type ChangedSection, type DiffRow,
} from '../lib/versionDiff'
import type { DocumentVersion } from '../types'

/**
 * 版本对比:`/reports/:id/diff?from=1&to=2`。
 *
 * 对比在前端做 —— 每个版本的原文服务端本来就能按 `?version=` 取,
 * 两篇研报的原文加起来也就几十 KB,不值得为它加一个接口。
 *
 * 不带参数时比「最新版 vs 上一版」;只带 to 就比 to 和它的上一版。
 * 选择的版本写回 URL,能分享、刷新不丢。
 */

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 选择框里用的短日期 M/D:手机上两个选择框各只有半行宽,完整日期会被截断 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function intParam(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number(v)
  return Number.isInteger(n) ? n : undefined
}

interface Loaded {
  title: string
  versions: DocumentVersion[]
  from: number
  to: number
  oldMd: string
  newMd: string
}

export default function VersionDiffPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromParam = intParam(searchParams.get('from'))
  const toParam = intParam(searchParams.get('to'))
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  /** 手动展开过的折叠段,按段起始行号记 */
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    setError('')
    ;(async () => {
      // 先取新的那一版:顺带拿到版本列表,from 缺省时才知道「上一版」是几
      const newer = await api.getDocument(id, toParam)
      const to = newer.version
      const from = fromParam ?? diffPairFor(newer.versions, to)[0]
      const older = from === to ? newer : await api.getDocument(id, from)
      if (cancelled) return
      const title = newer.versions.find(v => v.version === to)?.filename ?? newer.document.filename
      setData({ title, versions: newer.versions, from, to, oldMd: older.markdown, newMd: newer.markdown })
      setExpanded(new Set())
      document.title = `版本对比 · ${title} — 研报站`
    })().catch(e => { if (!cancelled) setError(String(e.message)) })
    return () => { cancelled = true }
  }, [id, fromParam, toParam])

  const rows = useMemo(() => (data ? diffMarkdown(data.oldMd, data.newMd) : []), [data])
  const stats = useMemo(() => diffStats(rows), [rows])
  const sections = useMemo(() => changedSections(rows), [rows])
  const segments = useMemo(() => segment(rows), [rows])

  function pick(from: number, to: number) {
    setSearchParams({ from: String(from), to: String(to) })
  }

  function jumpTo(s: ChangedSection) {
    document.getElementById(`diff-row-${s.firstRow}`)?.scrollIntoView({ block: 'center' })
  }

  const back = (
    <BackLink
      to={data && data.versions.length && data.to !== data.versions[data.versions.length - 1].version
        ? `/reports/${id}?v=${data.to}`
        : `/reports/${id}`}
      className="text-[13px] text-ink-soft hover:text-navy"
    >
      返回阅读
    </BackLink>
  )

  if (error) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 md:px-10">
        {back}
        <p className="mt-4">{error}</p>
      </div>
    )
  }
  if (!data) return <div className="mx-auto max-w-[1100px] px-4 py-8 text-ink-faint md:px-10">加载中…</div>

  // 正文按已经取回来的这一对画;选择器以 URL 为准 —— 换了版本、新的一对还没取回来时
  // 再点交换,拿到的是刚选的值而不是屏幕上的旧值
  const { versions, from, to } = data
  const selFrom = fromParam ?? from
  const selTo = toParam ?? to
  const noChange = rows.every(r => r.kind === 'same')
  // from → to 之间(不含 from)每一版的更新说明:这一段到底更新了什么
  const [lo, hi] = from < to ? [from, to] : [to, from]
  const notes = versions.filter(v => v.version > lo && v.version <= hi && v.note)

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-5 md:px-10 md:pt-8">
      {back}
      <h1 className="mb-1 mt-3 font-serif-sc text-[20px] font-semibold leading-[1.4] md:text-[24px]">{data.title}</h1>
      <p className="mb-5 text-[13px] text-ink-mute">版本对比</p>

      {/* 选版本 + 统计 + 视图切换 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-rule py-3">
        {/* 手机上两个选择框各占半行、跟着收窄,不然 375 宽放不下两个带日期的版本 */}
        <div className="flex w-full items-center gap-1.5 md:w-auto md:gap-2">
          <VersionSelect label="旧版" value={selFrom} versions={versions} onChange={v => pick(v, selTo)} />
          <button
            type="button"
            aria-label="交换新旧版"
            onClick={() => pick(selTo, selFrom)}
            className="flex size-8 flex-none cursor-pointer items-center justify-center rounded text-ink-mute hover:bg-aside hover:text-navy"
          >
            <SwapOutlined aria-hidden />
          </button>
          <VersionSelect label="新版" value={selTo} versions={versions} onChange={v => pick(selFrom, v)} />
        </div>
        {!noChange && (
          <div className="flex items-center gap-3 font-numeral text-[13px]" aria-label="改动统计">
            {stats.added > 0 && <span className="text-short">+{stats.added} 行</span>}
            {stats.removed > 0 && <span className="text-long">−{stats.removed} 行</span>}
            {stats.modified > 0 && <span className="text-warn">~{stats.modified} 处修改</span>}
          </div>
        )}
        {!noChange && (
          <div className="ml-auto flex rounded border border-edge p-0.5 text-[13px]" role="group" aria-label="显示范围">
            {([false, true] as const).map(all => (
              <button
                key={String(all)}
                type="button"
                aria-pressed={showAll === all}
                onClick={() => setShowAll(all)}
                className={`cursor-pointer rounded-[3px] px-3 py-1 ${showAll === all ? 'bg-navy text-page' : 'text-ink-soft hover:text-navy'}`}
              >
                {all ? '全文' : '只看改动'}
              </button>
            ))}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="mb-5 flex flex-col gap-1.5 rounded bg-aside px-4 py-3 text-[13px] text-ink-soft">
          {notes.map(v => (
            <li key={v.version}>
              <span className="font-medium text-ink">v{v.version}</span>
              <span className="ml-2 font-numeral text-ink-mute">{formatDate(v.created_at)}</span>
              <span className="ml-2">{v.note}</span>
            </li>
          ))}
        </ul>
      )}

      {from === to ? (
        <p className="py-10 text-center text-[14px] text-ink-mute">选的是同一个版本,换一个再比。</p>
      ) : noChange ? (
        <p className="py-10 text-center text-[14px] text-ink-mute">v{from} 和 v{to} 的正文没有区别。</p>
      ) : (
        <>
          <nav aria-label="改动的章节" className="mb-6">
            <div className="mb-2 text-[12px] tracking-[0.08em] text-ink-mute">改动的章节 · {sections.length}</div>
            <ul className="flex flex-wrap gap-2">
              {sections.map(s => (
                <li key={s.firstRow}>
                  <button
                    type="button"
                    onClick={() => jumpTo(s)}
                    className="flex max-w-[320px] cursor-pointer items-center gap-1.5 rounded border border-edge bg-white px-2.5 py-1 text-left text-[13px] text-ink hover:border-navy"
                  >
                    <SectionBadge status={s.status} />
                    <span className="truncate">{s.title}</span>
                    {s.status === 'changed' && <span className="flex-none font-numeral text-[12px] text-ink-faint">{s.changes}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="overflow-hidden rounded border border-rule bg-white">
            {showAll
              ? rows.map((r, i) => <Row key={i} row={r} index={i} />)
              : segments.map(seg => seg.type === 'rows' || expanded.has(seg.start)
                ? seg.rows.map((r, k) => <Row key={seg.start + k} row={r} index={seg.start + k} />)
                : (
                  <button
                    key={`gap-${seg.start}`}
                    type="button"
                    onClick={() => setExpanded(prev => new Set(prev).add(seg.start))}
                    className="block w-full cursor-pointer border-y border-row-rule bg-aside py-1.5 text-center text-[12px] text-ink-mute first:border-t-0 last:border-b-0 hover:text-navy"
                  >
                    ⋯ 展开 {seg.rows.length} 行未改动
                  </button>
                ))}
          </div>
        </>
      )}

      <p className="mt-6 text-[12px] text-ink-faint">
        按 markdown 原文逐行比较;一行里只改了几个字的,标出具体改动。
        <Link to={`/reports/${id}?v=${from}`} className="ml-2 text-navy hover:text-brick">看 v{from} 全文</Link>
        <Link to={`/reports/${id}?v=${to}`} className="ml-2 text-navy hover:text-brick">看 v{to} 全文</Link>
      </p>
    </main>
  )
}

function VersionSelect({ label, value, versions, onChange }: {
  label: string
  value: number
  versions: DocumentVersion[]
  onChange: (v: number) => void
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-mute md:flex-none">
      {label}
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-8 min-w-0 flex-1 cursor-pointer rounded border border-edge bg-white pl-2 pr-1 text-[13px] text-ink hover:border-navy"
      >
        {[...versions].reverse().map(v => (
          <option key={v.version} value={v.version}>v{v.version} · {shortDate(v.created_at)}</option>
        ))}
      </select>
    </label>
  )
}

function SectionBadge({ status }: { status: ChangedSection['status'] }) {
  if (status === 'added') return <span className="flex-none rounded-[3px] bg-short-wash px-1 text-[11px] text-short">新增</span>
  if (status === 'removed') return <span className="flex-none rounded-[3px] bg-long-wash px-1 text-[11px] text-long">删除</span>
  return <span className="flex-none rounded-[3px] bg-[#FBF3E6] px-1 text-[11px] text-warn">修改</span>
}

const MARK = { same: '', add: '+', del: '−', mod: '~' } as const
const SR = { same: '', add: '新增:', del: '删除:', mod: '修改:' } as const
const ROW_BG = {
  same: '',
  add: 'bg-short-wash',
  del: 'bg-long-wash',
  mod: 'bg-[#FDF8EF]',
} as const
const MARK_COLOR = { same: '', add: 'text-short', del: 'text-long', mod: 'text-warn' } as const

function Row({ row, index }: { row: DiffRow; index: number }) {
  const { line } = row
  const text = line.heading ? headingTitle(line.text) : line.text
  const textCls = line.code
    ? 'overflow-x-auto whitespace-pre font-mono text-[12px] leading-[1.5]'
    : `whitespace-pre-wrap break-words ${line.heading ? 'font-serif-sc text-[15px] font-semibold' : 'text-[14px]'} leading-[1.7]`
  return (
    <div
      id={`diff-row-${index}`}
      className={`grid grid-cols-[22px_minmax(0,1fr)] border-b border-row-rule last:border-b-0 ${ROW_BG[row.kind]}`}
    >
      <span aria-hidden className={`select-none pt-[5px] text-center font-mono text-[13px] ${MARK_COLOR[row.kind]}`}>
        {MARK[row.kind]}
      </span>
      <div className={`py-1 pr-3 ${textCls} ${row.kind === 'same' ? 'text-ink-soft' : row.kind === 'del' ? 'text-ink-mute' : 'text-ink'}`}>
        {row.kind !== 'same' && <span className="sr-only">{SR[row.kind]}</span>}
        {row.kind === 'mod'
          ? row.parts.map((p, i) => {
            if (p.op === 'add') return <ins key={i} className="rounded-[2px] bg-[#CFE6D9] no-underline">{p.text}</ins>
            if (p.op === 'del') return <del key={i} className="rounded-[2px] bg-[#F4D2CF] text-ink-mute decoration-long/60">{p.text}</del>
            return <span key={i}>{p.text}</span>
          })
          : row.kind === 'del' ? <del className="no-underline">{text}</del>
          : row.kind === 'add' ? <ins className="no-underline">{text}</ins>
          : text}
      </div>
    </div>
  )
}
