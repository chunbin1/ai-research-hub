import GithubSlugger from 'github-slugger'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

export function extractToc(md: string): Array<{ level: number; title: string; slug: string }> {
  const slugger = new GithubSlugger()
  const out: Array<{ level: number; title: string; slug: string }> = []
  for (const line of md.split('\n')) {
    const m = HEADING_RE.exec(line)
    if (m) out.push({ level: m[1].length, title: m[2].trim(), slug: slugger.slug(m[2].trim()) })
  }
  return out
}

export interface OutlineItem {
  level: number
  title: string
  slug: string
  /** 是「章」(目录的第一层)还是「节」 */
  top: boolean
  /** 所属章的 slug;章自己就是自己。开篇就出现、前面没有章的节是 '' */
  chapter: string
}

/**
 * 阅读页目录的条目:只列两层(章 + 节)。研报的 h1 是标题本身,不进目录;
 * 更深的多是表格前的小标题,列进来目录长得没法扫。有的报告整篇只用 h1,那就从 h1 起算。
 */
export function outlineOf(toc: ReturnType<typeof extractToc>): OutlineItem[] {
  const body = toc.some(t => t.level > 1) ? toc.filter(t => t.level > 1) : toc
  const base = Math.min(...body.map(t => t.level))
  let chapter = ''
  return body.filter(t => t.level <= base + 1).map(t => {
    const top = t.level === base
    if (top) chapter = t.slug
    return { ...t, top, chapter }
  })
}

/**
 * 目录里实际显示的条目:章全部列出,节只列当前读到的那一章的。
 * 一篇研报的节动辄四五十条,全摊开要滚很久才找得到章。
 * `activeSlug` 是当前高亮的条目(章或节都可能),还没读到任何标题时为 ''。
 */
export function visibleOutline(items: OutlineItem[], activeSlug: string): OutlineItem[] {
  const activeChapter = items.find(t => t.slug === activeSlug)?.chapter ?? ''
  return items.filter(t => t.top || t.chapter === activeChapter)
}
