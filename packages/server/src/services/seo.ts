// packages/server/src/services/seo.ts
//
// 给搜索引擎看的东西:每个页面 <head> 里的标题 / 摘要 / canonical,外加
// robots.txt 和 sitemap.xml。前端是纯 SPA,index.html 里只有一个空 #root,
// 爬虫在跑 JS 之前什么都看不到 —— head 由 client 容器的 nginx 用 SSI 向
// /api/seo/head/<原路径> 要一段,拼进 index.html 再发出去。
//
// 这里只放纯函数,不碰库和文件,方便测;取数在 routes/seo.ts。
import type { Document } from '../types.js'

export const SITE_NAME = '研报站'
export const SITE_DESCRIPTION =
  '行业与公司投资研究报告精读站：产业链全景、个股深度分析与股票信号追踪，每篇研报都可以直接向 AI 提问，答案标注来源并可跳回原文章节。'

/** 摘要上限。中文结果页大约显示 80–120 字,多给一点让搜索引擎自己截。 */
const DESCRIPTION_MAX = 150

export type PageMeta =
  | { kind: 'home' }
  | { kind: 'signals' }
  | { kind: 'report'; id: string }
  | { kind: 'noindex' }

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

/** 按 SPA 路由(不带开头的 /,不带查询串)判断这是哪类页面。 */
export function classifyPath(path: string): PageMeta {
  const p = path.replace(/^\/+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (p === '') return { kind: 'home' }
  if (p === 'signals') return { kind: 'signals' }
  const m = /^reports\/([^/]+)$/.exec(p)
  // 解码后再校验一遍:%2F..%2F 这种解出来带 / 或 . 的不是研报 id
  const id = m && safeDecode(m[1])
  if (id && /^[\w-]+$/.test(id)) return { kind: 'report', id }
  // 其余一律不进索引:后台、设置、观测与评测、版本对比(正文与研报页重复),
  // 以及前端根本没有的路由 —— 免得收进一堆空壳页
  return { kind: 'noindex' }
}

const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef'

/** 去掉行内 markdown 记号,只留给人读的文字。 */
function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // 链接留文字
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/<[^>]+>/g, '')
}

/** 把一段里的换行合起来:任一侧是中文就直接相连,两侧都是西文才换成一个空格。 */
function joinLines(s: string): string {
  return s
    .replace(new RegExp(`([${CJK}])[ \\t]*\\n\\s*`, 'g'), '$1')
    .replace(new RegExp(`[ \\t]*\\n\\s*(?=[${CJK}])`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 字段行 / 加粗小标题:「**报告日期**:2026-08-01」「**信息丰富度评级:A级**」「**核心结论**」。
 * 判据是值里没有句末标点、不成句;「**一句话定性**:碳酸锂是……生意。」是完整的句子,算正文。
 */
function isFieldLine(line: string): boolean {
  const m = /^\*\*[^*]+\*\*\s*[:：]\s*(.*)$/.exec(line) ?? /^\*\*([^*]+)\*\*$/.exec(line)
  return !!m && !/[。！？!?]|\.(\s|$)/.test(m[1])
}

/**
 * 从研报正文里取一段摘要,做 meta description。
 *
 * 研报开头通常是「# 标题」+ 一段引用块(研究框架 / 免责声明 / 演示数据提示),
 * 有的还跟着「**报告日期**:…」式的字段(连成一块或空行隔开都有)。真正的内容
 * 从第一个普通段落开始 —— 所以先找普通段落;全篇都没有普通段落时才退回到
 * 引用块和列表。标题行、表格行、分隔线、代码块、字段行一律跳过。
 */
export function excerpt(md: string, max = DESCRIPTION_MAX): string {
  const body = md.replace(/\r\n?/g, '\n').replace(/^```[\s\S]*?^```/gm, '')
  const blocks = body.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const paragraphs: string[] = []
  const fallback: string[] = []
  for (const block of blocks) {
    // 标题、表格按行去掉而不是整块丢:「# 标题」下一行紧跟正文、中间没空行的也有
    const lines = block.split('\n').filter(l => !/^\s*(#{1,6}(\s|$)|\|)/.test(l))
    const b = lines.join('\n').trim()
    if (!b || /^([-*_]{3,}\s*$|<)/.test(b)) continue
    // 字段行拼进摘要读不通
    if (lines.every(l => isFieldLine(l.trim()))) continue
    if (/^(>|[-*+]\s|\d+[.)]\s)/.test(b)) {
      fallback.push(lines.map(l => l.replace(/^(>\s?|[-*+]\s+|\d+[.)]\s+)/, '')).join('\n'))
      continue
    }
    paragraphs.push(b)
  }
  let out = ''
  for (const b of (paragraphs.length ? paragraphs : fallback)) {
    const text = joinLines(stripInline(b))
    if (!text) continue
    out = out ? `${out} ${text}` : text
    if ([...out].length >= max) break
  }
  const chars = [...out]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : out
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface HeadInput {
  title: string
  description?: string
  /** 绝对地址;不给就不出 canonical / og:url */
  url?: string
  noindex?: boolean
  /** 研报页出 article 相关的 og 标签 */
  article?: { publishedAt: string; modifiedAt: string }
}

/** 拼一段放进 <head> 的标签。每个值都转义过,研报标题是上传者写的,不可信。 */
export function renderHead(h: HeadInput, siteUrl: string): string {
  const e = escapeHtml
  const tags = [`<title>${e(h.title)}</title>`]
  if (h.noindex) {
    tags.push('<meta name="robots" content="noindex" />')
    return tags.join('\n    ')
  }
  if (h.description) tags.push(`<meta name="description" content="${e(h.description)}" />`)
  if (h.url) tags.push(`<link rel="canonical" href="${e(h.url)}" />`)
  tags.push(
    `<meta property="og:site_name" content="${e(SITE_NAME)}" />`,
    '<meta property="og:locale" content="zh_CN" />',
    `<meta property="og:type" content="${h.article ? 'article' : 'website'}" />`,
    `<meta property="og:title" content="${e(h.title)}" />`,
  )
  if (h.description) tags.push(`<meta property="og:description" content="${e(h.description)}" />`)
  if (h.url) tags.push(`<meta property="og:url" content="${e(h.url)}" />`)
  tags.push(
    `<meta property="og:image" content="${e(`${siteUrl}/favicon-512x512.png`)}" />`,
    '<meta name="twitter:card" content="summary" />',
  )
  if (h.article) {
    tags.push(
      `<meta property="article:published_time" content="${e(h.article.publishedAt)}" />`,
      `<meta property="article:modified_time" content="${e(h.article.modifiedAt)}" />`,
    )
  }
  return tags.join('\n    ')
}

export function robotsTxt(siteUrl: string): string {
  // /api 不能拦:Google 渲染研报页时要靠它取正文。
  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /settings',
    'Disallow: /traces',
    'Disallow: /eval',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function sitemapXml(siteUrl: string, docs: Pick<Document, 'id' | 'updated_at'>[]): string {
  const url = (loc: string, lastmod?: string) =>
    `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`
  // docs 已按更新时间倒序,第一篇就是全站最近一次更新
  const entries = [
    url(`${siteUrl}/`, docs[0]?.updated_at),
    url(`${siteUrl}/signals`),
    ...docs.map(d => url(`${siteUrl}/reports/${encodeURIComponent(d.id)}`, d.updated_at)),
  ]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}
