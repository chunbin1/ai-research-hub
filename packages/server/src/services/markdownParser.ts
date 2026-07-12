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
  bodyStart: number  // 正文(标题行之后)在原文中的起始偏移
  bodyEnd: number
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
      sections.push({ title: '', slug: '', path: '', bodyStart: 0, bodyEnd: end })
    }
  }

  const stack: Array<{ level: number; title: string }> = []
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    stack.push({ level: h.level, title: h.title })
    const path = stack.map(s => s.title).join(' / ')
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].lineStart : md.length
    sections.push({ title: h.title, slug: h.slug, path, bodyStart: h.bodyStart, bodyEnd })
  }
  return sections
}

/** 在 [start,end) 内按 \n\n 边界把内容切成 ≤ maxChars 的片段,返回带绝对偏移的片段。 */
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
    if (pEnd - cur > maxChars && cur < pStart) {
      pieces.push({ start: cur, end: pStart })
      cur = pStart
    }
  }
  pieces.push({ start: cur, end })
  return pieces
}

export function parseMarkdown(md: string, opts: { maxChars?: number } = {}): { displayName: string; chunks: MdChunk[] } {
  const maxChars = opts.maxChars ?? 1200
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(md)
  const displayName = h1 ? h1[1].trim() : ''

  const sections = buildSections(md)
  const chunks: MdChunk[] = []
  let idx = 0
  for (const s of sections) {
    for (const piece of splitByParagraph(md, s.bodyStart, s.bodyEnd, maxChars)) {
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
