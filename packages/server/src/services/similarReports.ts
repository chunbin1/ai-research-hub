// packages/server/src/services/similarReports.ts
/**
 * 上传前查重:库里有没有「这篇的旧版本」。给上传弹窗用,列出真的像的(最多 3 篇),
 * 让管理员决定是作为其中一篇的新版本上传,还是新建一篇 —— 这里只筛选、排序、给依据,
 * 不替人做决定。一篇都不像就不列,上传直接走新建。
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
 *   前两路都是 0。它的绝对分数分不开(同一套模板写的研报之间普遍 0.6~0.7),所以看的是
 *   「比库里其余研报的中位数高出多少」:模板把所有分数一起抬高,差值不受影响。
 *   量过:真的旧版本、同题材的两篇领先 0.18~0.32;库里不相干的研报两两轮流比、
 *   宁德时代、中国大模型这类,最高只领先 0.124。门槛取 0.15。
 *
 * **类型只用来压掉「标题 / 主题撞词」的误报,不用来排除正文本身。** 上传和候选两边的类型
 * (行业 / 公司)都已知且不同时,候选只有**正文重合过线**才保留:同一家公司的公司研报和产业链报告
 * 共享「中国海洋石油」这种高区分度的词,标题分会过线,但它们是两篇不同的报告;而正文重合
 * 在不同研报之间最高只有约 3%(公司研报与同公司的产业链报告也不到 6%),过线了就是同一篇 ——
 * 哪怕上传方的类型被推断错了(标题写「白酒行业龙头」的公司研报被预填成行业研报),
 * 也不能因此漏掉库里一模一样的旧版本、静默建出重复的一篇。库里每一行都有确定的类型,
 * 所以「任一边未知则不过滤」只对上传方未知(推断不出、也没选)生效。
 * 主题中位数只在保留下来的子集上算(不同类的模板不同,混着算会把基线抬歪)。
 *
 * 前两路过线的算「很可能是旧版本」(likely),排在最前;其余只有主题明显领先的才列,
 * 按主题相近度排。向量不可用时没有主题分,只返回 likely 的。
 */

import type { ReportKind } from './reportKind.js'

export interface ExistingReport {
  id: string
  title: string
  /** 行业研报 / 公司研报;未知(旧数据、测试)时不参与分类过滤 */
  kind?: ReportKind
  /** 最新版正文;原文缺失的老文档为 null,只比标题 */
  markdown: string | null
}

export interface SimilarReport {
  id: string
  titleScore: number
  contentScore: number
  /** 主题相近度(embedding 余弦);向量不可用时为 null */
  topicScore: number | null
  /** 标题判断:去掉版本标记后相同 / 过线 / 没对上。给界面直接用,不让前端再抄一份阈值 */
  titleMatch: 'same' | 'similar' | null
  /** 正文重合过线 */
  contentMatch: boolean
  /** titleMatch 或 contentMatch:很可能就是这篇的旧版本 */
  likely: boolean
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>

const TITLE_MIN = 0.1
const CONTENT_MIN = 0.06
const MAX_CANDIDATES = 3
/** 主题分至少比库里中位数高出这么多,才算「标题正文没对上、但主题明显更近」 */
const TOPIC_LEAD = 0.15
/** 库太小时中位数没意义,不看主题 */
const TOPIC_MIN_LIBRARY = 4
const SHINGLE = 5
/**
 * 主题指纹取「标题 + 正文开头」这么多字。开头通常是执行摘要,最能说明研究的是什么;
 * 目录不行 —— 这批研报是同一套框架写的,章节几乎都是「第一步…第八步:综合决策备忘录」。
 */
const FINGERPRINT_CHARS = 1500

/**
 * 股票代码:A 股 6 位(可带 .SH/.SZ/.BJ)、港股 4~5 位带 .HK、美股带交易所前缀(NYSE: ALB)。
 * 代码要整段比:拆成 bigram 的话,「601088.SH」和「600519.SH」会因为共有「60」「sh」
 * 被判成相近 —— 中国神华就这样撞上了贵州茅台。整段相同则是很强的「同一家公司」信号。
 */
const CODE_RE = /\b\d{6}\b(?:\s*\.\s*(?:sh|sz|bj|ss))?|\b\d{4,5}\s*\.\s*hk\b|(?:nyse|nasdaq|amex|hkex|otc)\s*[:：]\s*[a-z.]+/gi

/** 标题里的代码,统一成 #600519 / #0700 / #alb */
function titleCodes(title: string): Set<string> {
  return new Set([...title.toLowerCase().matchAll(CODE_RE)].map(m => '#' + m[0]
    .replace(/^[a-z]+\s*[:：]\s*/, '')
    .replace(/\s*\.\s*[a-z]+$/, '')
    .replace(/\s/g, '')))
}

/**
 * 去掉代码、空白、标点和版本标记(v2 / Q3 / 2026Q3 / 2026 年 / 更新…),这些不说明「是不是同一篇」。
 * 代码要先摘掉:「002049」里藏着「2049」,后面按年份去会把代码切碎。
 */
function normalizeTitle(s: string): string {
  return strip(s.toLowerCase().replace(CODE_RE, ' ')).replace(/v\d+|(20\d\d)?q[1-4]|20\d\d年?|更新|修订|最新/g, '')
}

/** 标题的比对单位:去掉代码后的字 bigram,加上整段的代码 */
function titleFeatures(title: string): Set<string> {
  return new Set([...bigrams(normalizeTitle(title)), ...titleCodes(title)])
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
  const grams = [title, ...existing.map(r => r.title)].map(titleFeatures)
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
  const codes = titleCodes(title)
  return grams.slice(1).map((g, i) => {
    // 去掉版本标记后一字不差:再常见的字也是同一篇 —— 除非两边代码对不上
    //(「（600519.SH）投资研究报告」和「（601088.SH）投资研究报告」去掉代码后一样)
    const other = titleCodes(existing[i].title)
    const codesAgree = codes.size === 0 || other.size === 0 || [...codes].some(c => other.has(c))
    if (norm && normalizeTitle(existing[i].title) === norm && codesAgree) return 1
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

/**
 * 库里研报的指纹向量,按「模型 + 指纹原文」缓存:版本变了指纹就变,不会读到旧的。
 * 每次查重后只留当前库里用得到的,旧版本、删掉的研报、换掉的模型不会越攒越多。
 */
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
  const scores = texts.map(t => cosine(query, fingerprintCache.get(key(t))!))
  const live = new Set(texts.map(key))
  for (const k of fingerprintCache.keys()) if (!live.has(k)) fingerprintCache.delete(k)
  return scores
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * 像的研报,最多 3 篇,最像的在前;一篇都不像返回空数组。
 * topic 是 topicScores 的结果;向量不可用时不传,这时只返回 likely 的。
 */
export function findSimilarReports(
  upload: { title: string; markdown: string; kind?: ReportKind },
  all: ExistingReport[],
  allTopic?: number[],
): SimilarReport[] {
  const round = (n: number) => Math.round(n * 100) / 100
  const body = shingles(upload.markdown)
  // 每篇的正文指纹只算一次:过滤和打分都要用
  const shingleCache = new Map<number, Set<number>>()
  const shinglesOf = (i: number) => {
    let sh = shingleCache.get(i)
    if (!sh) shingleCache.set(i, sh = shingles(all[i].markdown!))
    return sh
  }
  // 类型不同的候选只在正文重合过线时保留(见上面的说明)。
  // topic 与 all 按下标对齐,过滤时两边同取子集
  const keep = all.map((_, i) => i).filter(i =>
    !upload.kind || !all[i].kind || all[i].kind === upload.kind
    || (all[i].markdown !== null && jaccard(body, shinglesOf(i)) >= CONTENT_MIN))
  const existing = keep.map(i => all[i])
  const topic = allTopic && keep.map(i => allTopic[i])
  if (existing.length === 0) return []
  // 标题分在整库上算,再取保留下来的子集。「太常见的 bigram 不计分」靠的是整库的文档频率:
  // 同类子集很小时(早期公司研报只有一两篇),「投资」「研究」「报告」这类模板字会被当成稀有字,
  // 任何新的公司研报都会和库里唯一那篇公司研报「标题相近」。
  const allTitles = titleScores(upload.title, all)
  const titles = keep.map(i => allTitles[i])
  const topicBar = topic && existing.length >= TOPIC_MIN_LIBRARY ? median(topic) + TOPIC_LEAD : Infinity

  const scored = existing.map((r, i) => {
    const titleScore = round(titles[i])
    const contentScore = r.markdown === null ? 0 : round(jaccard(body, shinglesOf(keep[i])))
    const topicScore = topic ? round(topic[i]) : null
    const titleMatch = titleScore >= 1 ? 'same' as const : titleScore >= TITLE_MIN ? 'similar' as const : null
    const contentMatch = contentScore >= CONTENT_MIN
    const likely = titleMatch !== null || contentMatch
    const strongest = Math.max(titleScore, contentScore)
    // 余弦 < 1,likely 的加 1 保证排在前面
    const rank = likely ? 1 + strongest : (topicScore ?? strongest)
    const topicLeads = topic !== undefined && topic[i] >= topicBar
    return { candidate: { id: r.id, titleScore, contentScore, topicScore, titleMatch, contentMatch, likely }, rank, keep: likely || topicLeads }
  })
  return scored
    .filter(s => s.keep)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_CANDIDATES)
    .map(s => s.candidate)
}
