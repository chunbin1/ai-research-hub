// packages/server/src/services/similarReports.ts
/**
 * 上传前查重:库里有没有「这篇的旧版本」。给上传弹窗用,让管理员决定是作为新版本上传
 * 还是新建一篇 —— 这里只给候选和理由,不替人做决定。
 *
 * 两路信号,任一命中就算候选:
 *
 * - **正文重合**(5 字 shingle 的 Jaccard)。同一篇改一版,正文大段照搬;不同研报之间
 *   即便用同一套模板(「研究框架:产业链全景扫描 + 四大师…」),重合也只有 2%~3%。
 *   在生产那批研报上量过:腾讯 v1/v2 是 98%,其余两两之间最高 3.3%。
 * - **标题相似**(字 bigram 的加权 Jaccard)。正文整篇重写时只能靠标题。难点是模板化
 *   的标题:「碳酸锂产业链投资研究报告」和「腾讯生态产业链投资研究报告」按字面有一半
 *   相同。所以出现在太多标题里的 bigram(产业、链投、研究、报告…)直接不计分,剩下的
 *   按 IDF 加权,分数落在「腾讯」「碳酸锂」这种区分度高的字上。
 *   同一批数据上:真的旧版本最低 0.11(「腾讯控股投资研究报告」→ 腾讯生态那篇),
 *   不相干的最高 0.09。
 */

export interface ExistingReport {
  id: string
  title: string
  /** 最新版正文;原文缺失的老文档为 null,只比标题 */
  markdown: string | null
}

export interface SimilarReport {
  id: string
  titleScore: number
  contentScore: number
}

const TITLE_MIN = 0.1
const CONTENT_MIN = 0.06
const MAX_CANDIDATES = 3
const SHINGLE = 5

/** 去掉空白、标点和版本标记(v2 / Q3 / 2026Q3 / 2026 年 / 更新…),这些不说明「是不是同一篇」 */
function normalizeTitle(s: string): string {
  return strip(s).replace(/v\d+|(20\d\d)?q[1-4]|20\d\d年?|更新|修订|最新/g, '')
}

function strip(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  if (s.length === 1) out.add(s)
  for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2))
  return out
}

/** FNV-1a,只用来把 shingle 压成数字省内存,碰撞对估算重合度无影响 */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** 标题行不算进正文:标题另有一路打分,短文里它还会压过正文本身 */
function shingles(md: string): Set<number> {
  const s = strip(md.replace(/^#\s+.*$/m, ''))
  const out = new Set<number>()
  for (let i = 0; i + SHINGLE <= s.length; i++) out.add(hash(s.slice(i, i + SHINGLE)))
  return out
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

/** 按与库里全部标题的对比结果,给新标题跟每篇打分 */
function titleScores(title: string, existing: ExistingReport[]): number[] {
  const grams = [title, ...existing.map(r => r.title)].map(t => bigrams(normalizeTitle(t)))
  const df = new Map<string, number>()
  for (const g of grams) for (const x of g) df.set(x, (df.get(x) ?? 0) + 1)
  // 库很小时(≤ 8 篇)至少容许两篇共有,不然「同一篇的两个版本」本身就会把关键字判成常见字
  const common = Math.max(2, grams.length / 4)
  const weight = (x: string) => {
    const n = df.get(x) ?? 0
    return n > common ? 0 : Math.log((grams.length + 1) / (n + 0.5))
  }
  const q = grams[0]
  const norm = normalizeTitle(title)
  return grams.slice(1).map((g, i) => {
    // 去掉版本标记后一字不差:再常见的字也是同一篇
    if (norm && normalizeTitle(existing[i].title) === norm) return 1
    let inter = 0
    let union = 0
    for (const x of new Set([...q, ...g])) {
      const w = weight(x)
      union += w
      if (q.has(x) && g.has(x)) inter += w
    }
    return union ? inter / union : 0
  })
}

/** 最像的在前,最多 3 篇;没有像的返回空数组 */
export function findSimilarReports(
  upload: { title: string; markdown: string },
  existing: ExistingReport[],
): SimilarReport[] {
  if (existing.length === 0) return []
  const titles = titleScores(upload.title, existing)
  const body = shingles(upload.markdown)
  const round = (n: number) => Math.round(n * 100) / 100

  return existing
    .map((r, i) => ({
      id: r.id,
      titleScore: round(titles[i]),
      contentScore: r.markdown === null ? 0 : round(jaccard(body, shingles(r.markdown))),
    }))
    .filter(c => c.titleScore >= TITLE_MIN || c.contentScore >= CONTENT_MIN)
    .sort((a, b) => Math.max(b.titleScore, b.contentScore) - Math.max(a.titleScore, a.contentScore))
    .slice(0, MAX_CANDIDATES)
}
