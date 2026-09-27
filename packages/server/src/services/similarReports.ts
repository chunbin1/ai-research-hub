// packages/server/src/services/similarReports.ts
/**
 * 上传前查重:库里有没有「这篇的旧版本」。给上传弹窗用,始终列出最相近的 3 篇,
 * 让管理员决定是作为其中一篇的新版本上传,还是新建一篇 —— 这里只排序、给依据,不替人做决定。
 *
 * 三路信号:
 *
 * - **正文重合**(5 字 shingle 的 Jaccard)。同一篇改一版,正文大段照搬;不同研报之间
 *   即便用同一套模板(「研究框架:产业链全景扫描 + 四大师…」),重合也只有 2%~3%。
 *   在生产那批研报上量过:腾讯 v1/v2 是 98%,其余两两之间最高 3.3%。
 * - **标题相似**(字 bigram 的加权 Jaccard)。难点是模板化的标题:「碳酸锂产业链投资研究
 *   报告」和「腾讯生态产业链投资研究报告」按字面有一半相同。所以出现在太多标题里的 bigram
 *   (产业、链投、研究、报告…)直接不计分,剩下的按 IDF 加权,分数落在「腾讯」「碳酸锂」
 *   这种区分度高的字上。同一批数据上:真的旧版本最低 0.11,不相干的最高 0.09。
 * - **主题相近**(「标题 + 正文开头」的 embedding 余弦)。管的是标题换了说法、正文也
 *   整篇重写的情况 ——「中海油:高股息的底气」对「中国海洋石油产业链投资研究报告」,
 *   前两路都是 0。它的绝对分数分不开(库里不相干的两篇之间也能到 0.69),但排序是准的,
 *   所以只拿来排序,不设门槛。
 *
 * 前两路过线的算「很可能是旧版本」(likely),排在最前;其余按主题相近度排。
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
  /** 主题相近度(embedding 余弦);向量不可用时为 null */
  topicScore: number | null
  /** 标题或正文过线:很可能就是这篇的旧版本 */
  likely: boolean
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>

const TITLE_MIN = 0.1
const CONTENT_MIN = 0.06
const MAX_CANDIDATES = 3
const SHINGLE = 5
/**
 * 主题指纹取「标题 + 正文开头」这么多字。开头通常是执行摘要,最能说明研究的是什么;
 * 目录不行 —— 这批研报是同一套框架写的,章节几乎都是「第一步…第八步:综合决策备忘录」。
 */
const FINGERPRINT_CHARS = 1500

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

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** 库里研报的指纹向量,按「模型 + 指纹原文」缓存:版本变了指纹就变,不会读到旧的 */
const fingerprintCache = new Map<string, number[]>()

/**
 * 上传的这篇与库里每篇的主题相近度,顺序与 existing 一致。
 * 库里的指纹只在第一次见到时算(一次批量请求),之后每次查重只多算上传这一篇。
 * 原文缺失的老文档拿标题当指纹。
 */
export async function topicScores(
  uploadMarkdown: string,
  existing: ExistingReport[],
  embed: EmbedFn,
  model: string,
): Promise<number[]> {
  const texts = existing.map(r => (r.markdown ?? r.title).slice(0, FINGERPRINT_CHARS))
  const key = (t: string) => `${model}\0${t}`
  const missing = [...new Set(texts.filter(t => !fingerprintCache.has(key(t))))]
  const [query, ...vectors] = await embed([uploadMarkdown.slice(0, FINGERPRINT_CHARS), ...missing])
  missing.forEach((t, i) => fingerprintCache.set(key(t), vectors[i]))
  return texts.map(t => cosine(query, fingerprintCache.get(key(t))!))
}

/**
 * 最相近的 3 篇(库里不足 3 篇就全列),最像的在前。
 * topic 是 topicScores 的结果;向量不可用时不传,只按标题和正文排。
 */
export function findSimilarReports(
  upload: { title: string; markdown: string },
  existing: ExistingReport[],
  topic?: number[],
): SimilarReport[] {
  if (existing.length === 0) return []
  const titles = titleScores(upload.title, existing)
  const body = shingles(upload.markdown)
  const round = (n: number) => Math.round(n * 100) / 100

  const scored = existing.map((r, i) => {
    const titleScore = round(titles[i])
    const contentScore = r.markdown === null ? 0 : round(jaccard(body, shingles(r.markdown)))
    const topicScore = topic ? round(topic[i]) : null
    const likely = titleScore >= TITLE_MIN || contentScore >= CONTENT_MIN
    const strongest = Math.max(titleScore, contentScore)
    // 余弦 < 1,likely 的加 1 保证排在前面
    const rank = likely ? 1 + strongest : (topicScore ?? strongest)
    return { candidate: { id: r.id, titleScore, contentScore, topicScore, likely }, rank }
  })
  return scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_CANDIDATES)
    .map(s => s.candidate)
}
