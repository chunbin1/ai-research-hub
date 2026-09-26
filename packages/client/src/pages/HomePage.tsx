import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Drawer, Modal } from 'antd'
import { DeleteOutlined, EllipsisOutlined, RightOutlined, UploadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { SiteHeader } from '../components/SiteHeader'
import { UploadVersionModal } from '../components/UploadVersionModal'
import { useFileDrop } from '../hooks/useFileDrop'
import { pickReportFile } from '../lib/reportUpload'
import { readCache, writeCache } from '../lib/storage'
import type { Document } from '../types'

/**
 * 首页 —— 按「研报站首页 v2」「研报站首页 移动端 v2」两份设计稿:
 * 桌面是一张「日期 | 标题 | 段数 | 操作」的细线表,管理操作悬停才出现;
 * 移动端每行是标题 + 「日期 · 段数」,管理操作收进「⋯」弹出的底部菜单。
 *
 * 日期是首次上传日期;更新过的研报另挂一个「v2 · 9/25 更新」标签(桌面跟在标题后,
 * 移动端在「日期 · 段数」前)。
 *
 * 桌面 / 移动的布局差异全部走 Tailwind 断点(hidden / md:hidden 切换同一份 DOM,
 * display:none 的分支读屏不会重复播报),不用 useIsMobile。
 * 顶栏(含栏目导航、上传入口、账号菜单)在 SiteHeader 里,与信号追踪页共用。
 */

/** 设计稿的日期格式:YYYY/M/D,不补零 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 更新标签的日期:M/D,同一行已经有年份了 */
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 「v2 · 9/25 更新」。只给更新过的研报;缓存里的旧列表没有 latest_version,按 1 处理。
 * size:sm = 移动端 11px,md = 桌面 12px(并按设计稿上提 2px,和标题的衬线基线对齐)。
 */
function VersionTag({ doc, size }: { doc: Document; size: 'sm' | 'md' }) {
  const v = doc.latest_version ?? 1
  if (v <= 1) return null
  return (
    <span
      className={`flex-none whitespace-nowrap rounded-[3px] bg-[#E4EAF0] text-navy ${
        size === 'sm' ? 'px-1.5 py-px text-[11px]' : 'relative -top-0.5 px-[7px] py-0.5 text-[12px]'
      }`}
    >
      v{v}{doc.updated_at && ` · ${formatShortDate(doc.updated_at)} 更新`}
    </span>
  )
}

/** 桌面表格的列:日期 | 标题 | 段数 | 操作。表头、骨架、数据行三处共用 */
const DESKTOP_COLS = 'md:grid md:grid-cols-[84px_minmax(0,1fr)_56px_104px] md:items-center md:gap-6 md:px-4 lg:grid-cols-[96px_minmax(0,1fr)_64px_104px]'

/**
 * 上一次拿到的研报列表。只为「刷新不抖」:有缓存就首帧直接画出列表,
 * 再拿服务端结果覆盖——列表一天也变不了几次,绝大多数刷新是零位移的。
 * 读不到缓存(首次访问 / 无痕模式)才退回骨架。
 */
const DOCS_CACHE_KEY = 'arh.docs'

/**
 * 骨架里的一根灰条。**必须用 &nbsp; 撑行高、而不是给个 h-[Npx]**:
 * 这样它的盒高完全由所在位置的 font-size / line-height 决定,和真实那一行
 * 的文字一模一样,数据到了不会整列跳。
 */
function Bar({ width }: { width: string }) {
  return (
    <span
      className={`inline-block animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none ${width}`}
    >
      &nbsp;
    </span>
  )
}

/** 骨架行 —— 结构与下面的 <article> 逐格对应 */
function SkeletonRow() {
  return (
    <div className={`flex items-start border-b border-row-rule py-3.5 md:py-[18px] ${DESKTOP_COLS}`} aria-hidden>
      <span className="hidden font-numeral text-[14px] md:block"><Bar width="w-[60px]" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5 md:pt-0">
        <span className="font-serif-sc text-[16px] font-semibold leading-[1.5] md:text-[18px] md:leading-[1.45]">
          <Bar width="w-4/5" />
        </span>
        <span className="font-numeral text-[12px] md:hidden"><Bar width="w-[40%]" /></span>
      </div>
      <span className="hidden md:block" />
      <span className="hidden md:block" />
    </div>
  )
}

/**
 * 研报行。管理员可以把文件直接拖到行上给这篇上传新版本(= 行上「上传新版本」
 * 按钮的拖拽版),拖到哪行哪行高亮。非管理员不挂拖拽处理。
 */
function DropRow({ enabled, onFiles, className, children }: {
  enabled: boolean
  onFiles: (files: File[]) => void
  className: (dragging: boolean) => string
  children: (dragging: boolean) => ReactNode
}) {
  const { dragging, dropProps } = useFileDrop(onFiles, !enabled)
  const active = enabled && dragging
  return (
    <article
      {...(enabled ? dropProps : {})}
      data-dragging={active || undefined}
      className={className(active)}
    >
      {children(active)}
    </article>
  )
}

export default function HomePage() {
  /** null = 这台设备上还没缓存过列表(首次访问 / 无痕模式),此时才需要骨架 */
  const [docs, setDocs] = useState<Document[] | null>(() => readCache<Document[]>(DOCS_CACHE_KEY))
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  /** 正在给哪篇上传新版本;null = 弹窗关着 */
  const [versionTarget, setVersionTarget] = useState<Document | null>(null)
  /** 拖到行上打开弹窗时预选的文件 */
  const [versionFile, setVersionFile] = useState<File | null>(null)
  /** 移动端「⋯」菜单打开在哪篇上;null = 关着 */
  const [menuTarget, setMenuTarget] = useState<Document | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true

  const rows = docs ?? []
  const showSkeleton = !loaded && docs === null

  const refresh = () => api.listDocuments()
    .then(list => { setDocs(list); writeCache(DOCS_CACHE_KEY, list) })
    .catch(e => setError(String(e.message)))
  useEffect(() => { refresh().finally(() => setLoaded(true)) }, [])

  /** 把文件拖到某篇研报行上 = 给它上传新版本:校验通过就带着文件打开弹窗 */
  function onRowDrop(doc: Document, files: File[]) {
    const picked = pickReportFile(files)
    if (picked.error !== undefined) { setError(picked.error); return }
    setError('')
    setVersionFile(picked.file)
    setVersionTarget(doc)
  }

  function openVersionModal(doc: Document | null) {
    setVersionFile(null)
    setVersionTarget(doc)
  }

  function onDelete(doc: Document) {
    Modal.confirm({
      title: '删除这篇报告?',
      content: doc.filename,
      okText: '删除',
      // 两个汉字的按钮 antd 默认会插空格(「删 除」),和站内其他按钮不一致
      okButtonProps: { danger: true, autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      cancelText: '取消',
      onOk: async () => { await api.deleteDocument(doc.id); await refresh() },
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-page font-sans-sc text-ink">
      <SiteHeader
        active="/"
        uploading={uploading}
        onUploadingChange={setUploading}
        onUploaded={() => { setError(''); void refresh() }}
        onUploadError={setError}
        dropDisabled={versionTarget !== null}
      />

      <main className="mx-auto flex w-full max-w-[1360px] flex-col px-[18px] pb-6 md:gap-5 md:px-7 md:pb-16 md:pt-9 lg:px-10">
        <div className="flex items-baseline justify-between border-b border-ink pb-2.5 pt-5 md:justify-start md:gap-3.5 md:border-b-0 md:p-0">
          <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[20px]">最新研报</h1>
          <span className="text-[12px] text-ink-faint md:text-[13px] md:text-ink-mute">
            共 {showSkeleton ? '—' : rows.length} 篇
          </span>
        </div>

        {error && <p className="pt-4 text-[13px] text-danger md:pt-0">{error}</p>}

        <div className="flex flex-col">
          {/* 桌面表头 */}
          <div className={`hidden border-b border-ink pb-2.5 text-[12px] text-ink-mute ${DESKTOP_COLS}`} aria-hidden>
            <span>日期</span>
            <span>标题</span>
            <span className="text-right">段数</span>
            <span />
          </div>

          {showSkeleton && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}

          {!showSkeleton && rows.map(doc => (
            <DropRow
              key={doc.id}
              enabled={isAdmin}
              onFiles={files => onRowDrop(doc, files)}
              className={dragging => `group relative flex items-start gap-1 border-b border-row-rule py-3.5 transition-colors duration-100 md:py-[18px] ${
                dragging ? 'bg-navy-wash shadow-[inset_0_0_0_1px_var(--color-navy)]' : 'md:hover:bg-[#F2F0EA]'
              } ${DESKTOP_COLS}`}
            >{dragging => (<>
              <span className="hidden font-numeral text-[14px] text-ink-faint md:block">{formatDate(doc.created_at)}</span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5 md:flex-row md:flex-wrap md:items-baseline md:gap-x-2.5 md:pt-0">
                <h2 className="m-0 font-serif-sc text-[16px] font-semibold leading-[1.5] text-ink [text-wrap:pretty] md:text-[18px] md:leading-[1.45]">
                  {/* 整行可点,但只有标题是真链接:伪元素铺满整行做点击区,
                      既保留「新标签页打开 / 键盘可达」,又不用给 article 挂 onClick。
                      行内其余可点元素(⋯ / 上传 / 删除)必须 z-[1] 浮在它上面。 */}
                  <Link
                    to={`/reports/${doc.id}`}
                    className="text-inherit after:absolute after:inset-0 after:content-['']"
                  >
                    {doc.filename}
                  </Link>
                </h2>
                <span className="hidden md:inline-flex"><VersionTag doc={doc} size="md" /></span>
                <div className="flex flex-wrap items-center gap-2 md:hidden">
                  <VersionTag doc={doc} size="sm" />
                  <span className="font-numeral text-[12px] text-ink-faint">
                    {formatDate(doc.created_at)} · {doc.chunk_count} 段
                  </span>
                </div>
              </div>

              <span className="hidden text-right font-numeral text-[14px] text-ink-mute md:block">
                {doc.chunk_count}
                <span className="sr-only"> 段</span>
              </span>

              {/* 桌面:悬停(或键盘聚焦)才出管理操作,箭头常驻;文件拖到行上时换成放置提示 */}
              <div className="hidden items-center justify-end gap-1 md:flex">
                {dragging && (
                  <span className="whitespace-nowrap text-[12px] text-navy">松开上传新版本</span>
                )}
                {isAdmin && !dragging && (
                  <>
                    <button
                      type="button"
                      title="上传新版本"
                      aria-label={`给「${doc.filename}」上传新版本`}
                      onClick={() => openVersionModal(doc)}
                      className="relative z-[1] flex size-8 cursor-pointer items-center justify-center rounded text-[16px] text-navy opacity-0 hover:bg-[#E4EAF0] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <UploadOutlined aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="删除"
                      aria-label={`删除「${doc.filename}」`}
                      onClick={() => onDelete(doc)}
                      className="relative z-[1] flex size-8 cursor-pointer items-center justify-center rounded text-[16px] text-ink-faint opacity-0 hover:bg-[#F6E3E1] hover:text-brick focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <DeleteOutlined aria-hidden />
                    </button>
                  </>
                )}
                {!dragging && <RightOutlined aria-hidden className="ml-1 text-[13px] text-ink-faint" />}
              </div>

              {/* 移动端:「⋯」打开底部菜单 */}
              {isAdmin && (
                <button
                  type="button"
                  aria-label={`「${doc.filename}」的更多操作`}
                  onClick={() => setMenuTarget(doc)}
                  className="relative z-[1] -mr-1.5 flex size-11 flex-none items-center justify-center text-[18px] text-ink-faint md:hidden"
                >
                  <EllipsisOutlined aria-hidden />
                </button>
              )}
            </>)}</DropRow>
          ))}

          {/* 空态:保留栏目头与分隔线,正文区只给一行说明 */}
          {loaded && rows.length === 0 && (
            <p className="py-6 text-[13px] text-ink-faint md:px-4">还没有研报</p>
          )}
        </div>
      </main>

      {/* 移动端行操作菜单 */}
      <Drawer
        placement="bottom"
        open={menuTarget !== null}
        onClose={() => setMenuTarget(null)}
        size="auto"
        closable={false}
        rootClassName="home-row-menu"
        styles={{ body: { padding: 0 }, section: { borderRadius: '14px 14px 0 0' } }}
      >
        <div className="flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 font-sans-sc">
          <div className="flex justify-center pb-2" aria-hidden>
            <div className="h-1 w-9 rounded-full bg-edge" />
          </div>
          <span className="border-b border-row-rule px-5 pb-3.5 pt-1.5 font-serif-sc text-[15px] font-semibold leading-[1.5] text-ink">
            {menuTarget?.filename}
          </span>
          <button
            type="button"
            onClick={() => { openVersionModal(menuTarget); setMenuTarget(null) }}
            className="flex h-[52px] items-center gap-3 border-b border-row-rule px-5 text-left text-[15px] text-navy"
          >
            <UploadOutlined aria-hidden className="text-[18px]" />
            上传新版本
          </button>
          <button
            type="button"
            onClick={() => { const d = menuTarget; setMenuTarget(null); if (d) onDelete(d) }}
            className="flex h-[52px] items-center gap-3 px-5 text-left text-[15px] text-brick"
          >
            <DeleteOutlined aria-hidden className="text-[18px]" />
            删除
          </button>
          <button
            type="button"
            onClick={() => setMenuTarget(null)}
            className="mx-3.5 mt-2 flex h-[46px] items-center justify-center rounded-full bg-aside text-[15px] text-ink-soft"
          >
            取消
          </button>
        </div>
      </Drawer>

      <UploadVersionModal
        doc={versionTarget}
        initialFile={versionFile}
        onClose={() => openVersionModal(null)}
        onUploaded={() => { openVersionModal(null); setError(''); void refresh() }}
      />
    </div>
  )
}
