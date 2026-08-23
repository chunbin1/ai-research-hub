// packages/server/src/services/retrievalEval.ts
//
// 检索评测:拿一组固定问题跑真实检索链路,输出可跨次比较的分层指标。
//
// 为什么不用现有的评估后台:那套是 LLM 反向出题(每次重新抽样、重新生成),
// 两次 run 的分数不可比 —— 分数变了你分不清是改动生效还是抽到了简单题。
// 这里的用例是**固定的、人工标注的**,同一套问题每次跑,才能回答
// 「这次改动到底让检索变好还是变差」。
//
// 另外它**只测检索,不调用 LLM**:只花 embedding,可以随便跑。
// 生成质量(忠实度、拒答)属于另一层,要另外测。

export interface EvalCase {
  id: string
  question: string
  /**
   * 命中判据:检索到的块里必须有一块包含这些文本之一。
   *
   * 用**文本锚点**而不是 chunk_index —— 切块规则一改(maxChars、标题处理)
   * 索引就全变了,用例会集体失效;而正文片段能活下来。
   *
   * 空数组表示「知识库里没有答案」的用例,不计入命中率。
   */
  expect: string[]
  /** 不该出现在结果里的文本:旧版本、无关主题、易混淆的邻近内容。 */
  forbid?: string[]
  /** 问题类型,用于分组看结果 —— 只看一个总分会掩盖「某一类全错」。 */
  tags: string[]
  /** 这条用例为什么存在。写清楚,否则半年后没人敢改它。 */
  why: string
}

export interface CaseOutcome {
  id: string
  /** true 命中 / false 未命中 / null 不适用(无答案用例) */
  hit: boolean | null
  /** 第一个命中块的名次(1 起算),未命中为 null */
  rank: number | null
  /** 命中的 forbid 文本 */
  violations: string[]
  tags: string[]
}

export interface TagStat {
  scored: number
  hits: number
  hitRate: number | null
}

export interface EvalSummary {
  total: number
  /** 参与命中率统计的用例数(排除无答案用例) */
  scored: number
  hits: number
  hitRate: number | null
  /** Mean Reciprocal Rank:命中越靠前越高。未命中记 0。 */
  mrr: number
  violations: number
  byTag: Record<string, TagStat>
}

export function scoreCase(c: EvalCase, retrieved: ReadonlyArray<{ content: string }>): CaseOutcome {
  const violations = (c.forbid ?? []).filter(f => retrieved.some(r => r.content.includes(f)))

  if (c.expect.length === 0) {
    return { id: c.id, hit: null, rank: null, violations, tags: c.tags }
  }

  const i = retrieved.findIndex(r => c.expect.some(e => r.content.includes(e)))
  return {
    id: c.id,
    hit: i >= 0,
    rank: i >= 0 ? i + 1 : null,
    violations,
    tags: c.tags,
  }
}

function rate(hits: number, scored: number): number | null {
  return scored === 0 ? null : hits / scored
}

export function summarize(outcomes: ReadonlyArray<CaseOutcome>): EvalSummary {
  const scorable = outcomes.filter(o => o.hit !== null)
  const hits = scorable.filter(o => o.hit).length

  const byTag: Record<string, TagStat> = {}
  for (const o of scorable) {
    for (const t of o.tags) {
      const s = (byTag[t] ??= { scored: 0, hits: 0, hitRate: null })
      s.scored++
      if (o.hit) s.hits++
    }
  }
  for (const s of Object.values(byTag)) s.hitRate = rate(s.hits, s.scored)

  return {
    total: outcomes.length,
    scored: scorable.length,
    hits,
    hitRate: rate(hits, scorable.length),
    // 分母用 scorable 而不是 total:无答案用例没有「名次」可言,
    // 把它们算进去会让 MRR 随无答案用例的数量漂移。
    mrr: scorable.length === 0 ? 0
      : scorable.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0) / scorable.length,
    violations: outcomes.reduce((n, o) => n + o.violations.length, 0),
    byTag,
  }
}
