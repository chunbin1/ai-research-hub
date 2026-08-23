// packages/server/src/services/rrf.ts
//
// Reciprocal Rank Fusion:把多路检索结果按**名次**融合成一个列表。
//
// 为什么是名次而不是分数:向量的 cosine 距离和 BM25 分数没有共同尺度
// (前者约 0.47~0.83,后者是无下界的负数)。更根本的是,实测表明 cosine
// 距离**跨查询不可比** —— 同一个块换个问法,距离能浮动 0.18,整个分布会
// 随查询长度整体平移。而相对名次是稳的。
//
//   RRF(d) = Σ 1 / (k + rank_i(d))
//
// k 压平头部差距:k 小则「某一路的第 1 名」权重极高,k 大则「两路都中游」
// 更容易胜出。工程上从 60 起调。

export interface FusedResult<T> {
  item: T
  score: number
  /** 该项在每一路里的名次(1 起算),没出现记 null。留给 trace 排查用。 */
  ranks: Array<number | null>
}

export function reciprocalRankFusion<T>(
  rankings: ReadonlyArray<readonly T[]>,
  idOf: (item: T) => string,
  opts: { k?: number; limit?: number } = {},
): Array<FusedResult<T>> {
  const k = opts.k ?? 60
  const acc = new Map<string, FusedResult<T>>()

  rankings.forEach((ranking, path) => {
    ranking.forEach((item, i) => {
      const key = idOf(item)
      let entry = acc.get(key)
      if (!entry) {
        // 首次出现的对象胜出:调用方把更完整的那一路放前面即可。
        entry = { item, score: 0, ranks: rankings.map(() => null) }
        acc.set(key, entry)
      }
      // 同一路里若重复出现同一 id,以更靠前的那次为准,分数不重复累加。
      if (entry.ranks[path] !== null) return
      entry.ranks[path] = i + 1
      entry.score += 1 / (k + i + 1)
    })
  })

  // Array#sort 在 V8 上是稳定排序,分数相同的项保持插入顺序 ——
  // 结果因此可复现,不会在两次调用间抖动。
  const fused = [...acc.values()].sort((a, b) => b.score - a.score)
  return opts.limit === undefined ? fused : fused.slice(0, opts.limit)
}
