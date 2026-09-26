import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from 'antd'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import { SiteHeader } from '../components/SiteHeader'
import { UploadVersionModal } from '../components/UploadVersionModal'
import { readCache, writeCache } from '../lib/storage'
import type { Document } from '../types'

/**
 * 首页 —— 按 design_handoff_homepage 的设计稿重建:纸感底色、衬线中文标题,
 * 以分隔线和留白代替卡片堆砌,研报列表是页面唯一重心。
 *
 * 桌面(≥1024)/ 平板(768–1023)/ 移动(<768)三档全部走 Tailwind 断点,
 * 不用 useIsMobile —— 那个 hook 按约定只服务行为差异,布局差异一律交给 md:/lg:。
 * 移动端与桌面端结构不同的几处(日期的位置、「阅读 ›」)用
 * hidden / md:hidden 切换同一份 DOM,display:none 的分支读屏不会重复播报。
 *
 * 顶栏(含栏目导航、上传入口、账号菜单)在 SiteHeader 里,与信号追踪页共用。
 */

/** 设计稿的日期格式:YYYY/M/D,不补零 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 上一次拿到的研报列表。只为「刷新不抖」:有缓存就首帧直接画出列表,
 * 再拿服务端结果覆盖——列表一天也变不了几次,绝大多数刷新是零位移的。
 * 读不到缓存(首次访问 / 无痕模式)才退回骨架。
 */
const DOCS_CACHE_KEY = 'arh.docs'

/**
 * 骨架里的一根灰条。**必须用 &nbsp; 撑行高、而不是给个 h-[Npx]**:
 * 这样它的盒高完全由所在位置的 font-size / line-height 决定,和真实那一行
 * 的文字一模一样。写死高度的老做法让骨架行是 82px、真实行是 93px,
 * 数据一到整列往下跳 11px × 5 行。
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

/** 骨架行 —— 结构与下面的 <article> 逐格对应,列宽、间距、断点全部照抄 */
function SkeletonRow() {
  return (
    <div
      className="flex flex-col gap-[9px] border-t border-row-rule py-4 md:grid md:grid-cols-[76px_minmax(0,1fr)_auto] md:items-baseline md:gap-6 md:py-5 md:first:border-t-0 lg:grid-cols-[92px_minmax(0,1fr)_auto]"
      aria-hidden
    >
      <span className="hidden font-numeral text-[14px] text-ink-faint md:block">
        <Bar width="w-[52px]" />
      </span>

      <div className="flex min-w-0 flex-col gap-[9px] md:gap-2">
        <h2 className="m-0 font-serif-sc text-[17px] font-semibold leading-[1.5] md:text-[19px] md:leading-[1.45]">
          <Bar width="w-4/5" />
        </h2>
        <div className="flex items-center gap-2 text-[11px] md:gap-2.5 md:text-[12px]">
          <Bar width="w-[38%]" />
        </div>
      </div>

      {/* 第三列真实内容是「阅读 ›」;它参与 items-baseline 的基线对齐,
          骨架里不占位的话桌面端行高会和真实行差一点 */}
      <div className="hidden md:flex md:items-baseline md:gap-3">
        <span className="text-[13px]">&nbsp;</span>
      </div>
    </div>
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
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true

  const rows = docs ?? []
  const showSkeleton = !loaded && docs === null

  const refresh = () => api.listDocuments()
    .then(list => { setDocs(list); writeCache(DOCS_CACHE_KEY, list) })
    .catch(e => setError(String(e.message)))
  useEffect(() => { refresh().finally(() => setLoaded(true)) }, [])

  function onDelete(id: string) {
    Modal.confirm({
      title: '删除这篇报告?',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => { await api.deleteDocument(id); await refresh() },
    })
  }

  return (
    // 整页撑满视口高度、主体网格吃掉剩余空间:研报少的时候右栏底色和左列右边框
    // 才会一直落到窗口底部,而不是在内容末尾拦腰断开(设计稿的画布高度看不出这点)。
    <div className="flex min-h-screen flex-col bg-page font-sans-sc text-ink">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">

        <SiteHeader
          active="/"
          uploading={uploading}
          onUploadingChange={setUploading}
          onUploaded={() => { setError(''); void refresh() }}
          onUploadError={setError}
        />

        {/* 设计稿这里是「列表 + 右栏」两列。右栏原本装「本周财报日历」和「按板块浏览」,
            两块都已下掉(前者无数据源、后者建在标题猜测上),右栏空了,竖分隔线和整片
            底色就没有存在意义 —— 暂时收成单列。列表宽度仍按设计稿左列的净宽给上限,
            免得标题行在宽屏上拉得过长。右栏内容一旦回来,把这层换回 grid 即可。 */}
        <div className="mx-auto w-full max-w-[1068px]">

          <main className="px-[18px] md:px-7 md:pb-14 md:pt-9 lg:px-10">
            <div className="flex items-baseline justify-between border-b border-ink pb-2 pt-[18px] md:pb-2.5 md:pt-0">
              <h1 className="m-0 font-serif-sc text-[16px] font-semibold text-ink md:text-[17px]">最新研报</h1>
              <span className="text-[12px] text-ink-faint md:text-[13px] md:text-ink-mute">
                共 {showSkeleton ? '—' : rows.length} 篇
              </span>
            </div>

            {error && <p className="pt-4 text-[13px] text-danger">{error}</p>}

            <div className="flex flex-col md:mt-6">
              {showSkeleton && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}

              {!showSkeleton && rows.map(doc => (
                <article
                  key={doc.id}
                  className="group relative flex flex-col gap-[9px] border-t border-row-rule py-4 transition-colors md:grid md:grid-cols-[76px_minmax(0,1fr)_auto] md:items-baseline md:gap-6 md:py-5 md:first:border-t-0 md:hover:bg-aside lg:grid-cols-[92px_minmax(0,1fr)_auto]"
                >
                  <span className="hidden font-numeral text-[14px] text-ink-faint md:block">
                    {formatDate(doc.created_at)}
                  </span>

                  <div className="flex min-w-0 flex-col gap-[9px] md:gap-2">
                    <h2 className="m-0 font-serif-sc text-[17px] font-semibold leading-[1.5] text-ink [text-wrap:pretty] md:text-[19px] md:leading-[1.45]">
                      {/* 整行可点,但只有标题是真链接:伪元素铺满整行做点击区,
                          既保留「新标签页打开 / 键盘可达」,又不用给 article 挂 onClick。
                          行内其余可点元素(删除)必须 z-[1] 浮在它上面。 */}
                      <Link
                        to={`/reports/${doc.id}`}
                        className="text-inherit after:absolute after:inset-0 after:content-['']"
                      >
                        {doc.filename}
                      </Link>
                    </h2>
                    <div className="flex items-center gap-2 text-[11px] text-ink-mute md:gap-2.5 md:text-[12px]">
                      <span className="hidden md:inline">{doc.chunk_count} 段</span>
                      {/* 更新过的才标;缓存里的旧列表没有 latest_version,按 1 处理 */}
                      {(doc.latest_version ?? 1) > 1 && (
                        <span className="whitespace-nowrap font-numeral">
                          v{doc.latest_version}
                          {doc.updated_at && ` · ${formatDate(doc.updated_at)} 更新`}
                        </span>
                      )}
                      <span className="ml-auto whitespace-nowrap font-numeral text-ink-faint md:hidden">
                        {formatDate(doc.created_at)} · {doc.chunk_count} 段
                      </span>
                      {/* 触屏没有 hover:移动端把删除放进标签行常显,桌面端在第三列悬停才出现 */}
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => setVersionTarget(doc)}
                            className="relative z-[1] text-[11px] text-navy md:hidden"
                          >
                            更新
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(doc.id)}
                            className="relative z-[1] text-[11px] text-danger md:hidden"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="hidden md:flex md:items-baseline md:gap-3">
                    <span className="text-[13px] text-navy">阅读 ›</span>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => setVersionTarget(doc)}
                          className="relative z-[1] text-[12px] text-navy opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          上传新版本
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(doc.id)}
                          className="relative z-[1] text-[12px] text-danger opacity-0 group-hover:opacity-100"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}

              {/* 空态:保留栏目头与分隔线,正文区只给一行说明(设计稿的空态规范) */}
              {loaded && rows.length === 0 && (
                <p className="py-6 text-[13px] text-ink-faint">还没有研报</p>
              )}
            </div>
          </main>

        </div>
      </div>

      <UploadVersionModal
        doc={versionTarget}
        onClose={() => setVersionTarget(null)}
        onUploaded={() => { setVersionTarget(null); setError(''); void refresh() }}
      />
    </div>
  )
}
