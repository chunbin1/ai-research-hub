// packages/server/src/services/markdownParser.ts
import GithubSlugger from 'github-slugger'

export interface MdChunk {
  content: string
  chunk_index: number
  section_title: string
  section_slug: string
  section_path: string
  char_start: number
  char_end: number
}

interface RawSection {
  title: string
  slug: string
  path: string
  headStart: number  // 标题行行首在原文中的偏移(引言节 = 0)
  bodyStart: number  // 正文(标题行之后)在原文中的起始偏移
  bodyEnd: number
  hasChild: boolean  // 下一个标题是否比自己更深一级
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** 扫描所有 ATX 标题,返回 {level,title,slug,lineStart(行首偏移),bodyStart(该行末尾+1)} */
function scanHeadings(md: string) {
  const slugger = new GithubSlugger()
  const heads: Array<{ level: number; title: string; slug: string; lineStart: number; bodyStart: number }> = []
  let offset = 0
  for (const line of md.split('\n')) {
    const m = HEADING_RE.exec(line)
    if (m) {
      const title = m[2].trim()
      heads.push({
        level: m[1].length,
        title,
        slug: slugger.slug(title),
        lineStart: offset,
        bodyStart: offset + line.length + 1,
      })
    }
    offset += line.length + 1 // +1 换行符
  }
  return heads
}

function buildSections(md: string): RawSection[] {
  const heads = scanHeadings(md)
  const sections: RawSection[] = []

  // 引言:首个标题之前的内容
  if (heads.length === 0 || heads[0].lineStart > 0) {
    const end = heads.length ? heads[0].lineStart : md.length
    if (md.slice(0, end).trim()) {
      sections.push({ title: '', slug: '', path: '', headStart: 0, bodyStart: 0, bodyEnd: end, hasChild: false })
    }
  }

  const stack: Array<{ level: number; title: string }> = []
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    stack.push({ level: h.level, title: h.title })
    const path = stack.map(s => s.title).join(' / ')
    const next = heads[i + 1]
    const bodyEnd = next ? next.lineStart : md.length
    sections.push({
      title: h.title,
      slug: h.slug,
      path,
      headStart: h.lineStart,
      bodyStart: h.bodyStart,
      bodyEnd,
      hasChild: !!next && next.level > h.level,
    })
  }
  return sections
}

/** 分隔线不算正文 —— 「标题 + --- + 子标题」里的 --- 不该让父标题当成有内容。 */
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

/** 一段文本除了分隔线和空白之外还有东西吗? */
function hasBody(text: string): boolean {
  return text.split('\n').some(l => l.trim() && !RULE_RE.test(l))
}

/** 一段文本是否只有标题行(和空行)—— 用于禁止在标题与其正文之间下刀。 */
function isOnlyHeadings(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim())
  return lines.length > 0 && lines.every(l => HEADING_RE.test(l))
}

/**
 * 在 [start,end) 内按 \n\n 边界把内容切成 ≤ maxChars 的片段,返回带绝对偏移的片段。
 *
 * 唯一的约束是**不在标题行和它后面的内容之间切开**。小节一旦超长,第一刀正好
 * 落在标题之后 —— 标题被孤立成一个十来字的空壳块,而真正的内容(往往是一张大
 * 表)反倒失去了标题。腾讯篇的「3.2 游戏开发/发行」、煤炭篇的「3.1 上游 · 动力
 * 煤开采」都是这么被切坏的。
 */
function splitByParagraph(md: string, start: number, end: number, maxChars: number) {
  const text = md.slice(start, end)
  if (text.trim().length <= maxChars) return [{ start, end }]
  const pieces: Array<{ start: number; end: number }> = []
  let cur = start
  const paras = text.split(/\n\n+/)
  let cursor = start
  for (const p of paras) {
    const pStart = md.indexOf(p, cursor)
    const pEnd = pStart + p.length
    cursor = pEnd
    if (pEnd - cur > maxChars && cur < pStart && !isOnlyHeadings(md.slice(cur, pStart))) {
      pieces.push({ start: cur, end: pStart })
      cur = pStart
    }
  }
  pieces.push({ start: cur, end })
  return pieces
}

/**
 * 切块。**每个 chunk 都从自己的标题行开始**,而不是从标题的下一行。
 *
 * 曾经是从正文起算的,于是这种写法的整节内容直接消失:
 *
 *     #### 4.C.5 估值：市值 ~¥252 亿，P/E ~12x，股息率 ~3.4%
 *
 *     #### 4.C.6 推荐度：**★★★☆☆（观察名单）**
 *
 * 标题行塞满了事实、标题后没有独立正文段落,取 [标题行末+1, 下个标题) 得到
 * 空串,`if (!content) continue` 把整节丢掉 —— 全库 418 个标题里有 71 个
 * (17%)从未进入任何 chunk,CNOOC 一篇就丢了 820 字。这不是排序问题:
 * 检索再准也召不回一段根本没被索引的文字。
 *
 * 把标题行并进正文之后,"标题即内容"自然被覆盖,顺带让向量那一路也能看见
 * 标题文本(它只 embed content,section_title 是不进向量的)。
 *
 * 只有一类标题不单独成块:**自己没有正文、但有子标题的**(「第二部分：产业链
 * 全景图」这种纯导航标题)。单独成块只是噪音,所以把它的标题行顺延并进第一个
 * 子节的开头 —— 既不丢字,也不产生只有一行标题的空壳块。
 */
export function parseMarkdown(md: string, opts: { maxChars?: number } = {}): { displayName: string; chunks: MdChunk[] } {
  const maxChars = opts.maxChars ?? 1200
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(md)
  const displayName = h1 ? h1[1].trim() : ''

  const sections = buildSections(md)
  const chunks: MdChunk[] = []
  let idx = 0
  let carry: number | null = null // 纯导航标题的行首,顺延给下一节
  for (const s of sections) {
    const start: number = carry ?? s.headStart
    if (!hasBody(md.slice(s.bodyStart, s.bodyEnd)) && s.hasChild) {
      carry = start
      continue
    }
    carry = null
    for (const piece of splitByParagraph(md, start, s.bodyEnd, maxChars)) {
      const content = md.slice(piece.start, piece.end).trim()
      if (!content) continue
      chunks.push({
        content,
        chunk_index: idx++,
        section_title: s.title,
        section_slug: s.slug,
        section_path: s.path,
        char_start: piece.start,
        char_end: piece.end,
      })
    }
  }
  return { displayName, chunks }
}
