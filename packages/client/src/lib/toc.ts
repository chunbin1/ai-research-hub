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
