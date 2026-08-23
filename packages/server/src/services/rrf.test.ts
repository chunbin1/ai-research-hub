import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reciprocalRankFusion } from './rrf.ts'

const id = (x: { id: string }) => x.id
const A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' }, D = { id: 'd' }
const ids = (r: Array<{ item: { id: string } }>) => r.map(x => x.item.id)

test('单路输入时保持原顺序', () => {
  const out = reciprocalRankFusion([[A, B, C]], id)
  assert.deepEqual(ids(out), ['a', 'b', 'c'])
})

test('两路都靠前的项排最前(双份证据)', () => {
  //  向量: b a c        BM25: b c a
  //  b 在两路都第 1,应压过只在单路靠前的 a
  const out = reciprocalRankFusion([[B, A, C], [B, C, A]], id)
  assert.equal(ids(out)[0], 'b')
})

test('只在一路出现的项仍能入选(互补,不是取交集)', () => {
  const out = reciprocalRankFusion([[A, B], [C, D]], id)
  assert.deepEqual(ids(out).sort(), ['a', 'b', 'c', 'd'])
})

// 线上实测过的关键性质:问「腾讯去年赚了多少钱」时 BM25 零召回,
// 融合结果必须原样保留向量的名次,不能因为多接了一路就被搅乱。
test('一路为空时,融合结果等于另一路原样', () => {
  const out = reciprocalRankFusion([[A, B, C], []], id)
  assert.deepEqual(ids(out), ['a', 'b', 'c'])
})

test('按 id 去重:同一项在两路出现只占一个位置', () => {
  const out = reciprocalRankFusion([[A, B], [A, B]], id)
  assert.equal(out.length, 2)
})

test('记录每一路的名次(1 起算),缺席记 null —— 供 trace 排查用', () => {
  const out = reciprocalRankFusion([[A, B], [B]], id)
  const b = out.find(x => x.item.id === 'b')!
  const a = out.find(x => x.item.id === 'a')!
  assert.deepEqual(b.ranks, [2, 1])
  assert.deepEqual(a.ranks, [1, null])
})

// k 是用来压平头部名次差距的:k 小则「某一路的第 1 名」权重极高,
// k 大则「两路都中游」更容易胜出。工程上从 60 起调。
// a 只在第一路出现且是第 1;c 在两路都只排第 3。
// k=0 时 a=1/1=1 > c=2/3;k=60 时 a=1/61 < c=2/63 —— 名次关系翻转。
test('k 越小越偏袒单路头名,k 越大越偏袒两路共识', () => {
  const rankings = [[A, B, C], [B, D, C]]
  const smallK = ids(reciprocalRankFusion(rankings, id, { k: 0 }))
  const bigK = ids(reciprocalRankFusion(rankings, id, { k: 60 }))
  assert.ok(smallK.indexOf('a') < smallK.indexOf('c'), 'k=0:单路第 1 名压过两路第 3 名')
  assert.ok(bigK.indexOf('c') < bigK.indexOf('a'), 'k=60:两路共识反超单路头名')
})

// RRF 的一个固有性质,值得钉住:只要 k > 0,「两路都第 2」恒定优于
// 「单路第 1」—— 2/(k+2) > 1/(k+1) ⟺ k > 0。调大调小 k 都改变不了,
// k=0 是二者恰好相等的边界。所以指望靠调 k 让某个单路头名翻身是徒劳的。
test('只要 k > 0,两路都排第 2 就恒定优于只在单路排第 1', () => {
  for (const k of [1, 10, 60, 600]) {
    const out = ids(reciprocalRankFusion([[A, B, C], [D, B, C]], id, { k }))
    assert.ok(out.indexOf('b') < out.indexOf('a'), `k=${k} 时应仍是 b 在前`)
  }
})

test('默认 k 为 60', () => {
  const rankings = [[A, C, D], [C, D, A]]
  assert.deepEqual(ids(reciprocalRankFusion(rankings, id)), ids(reciprocalRankFusion(rankings, id, { k: 60 })))
})

test('limit 截断', () => {
  const out = reciprocalRankFusion([[A, B, C, D]], id, { limit: 2 })
  assert.deepEqual(ids(out), ['a', 'b'])
})

test('不传 limit 时全部返回', () => {
  assert.equal(reciprocalRankFusion([[A, B, C, D]], id).length, 4)
})

test('全空输入返回空数组', () => {
  assert.deepEqual(reciprocalRankFusion([[], []], id), [])
})

test('分数相同时顺序稳定(先出现的在前),避免结果随机抖动', () => {
  const out = reciprocalRankFusion([[A, B], [B, A]], id)
  assert.deepEqual(ids(out), ['a', 'b'])
})

test('同一 id 保留首次出现的那个对象', () => {
  const vecHit = { id: 'a', from: 'vector' }
  const bmHit = { id: 'a', from: 'bm25' }
  const out = reciprocalRankFusion([[vecHit], [bmHit]], x => x.id)
  assert.equal(out[0].item.from, 'vector')
})
