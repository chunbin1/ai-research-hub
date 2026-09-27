import { diffArrays } from 'diff'

/**
 * 两个版本的研报原文对比。
 *
 * 以「行」为单位比:研报里一段正文、一个列表项、一行表格都各占一行,
 * 改了一行表格不会把整张表标红。空行不参与(只是段落分隔,增删它没有意义)。
 *
 * 行级对比出来的「删一行 + 加一行」如果其实是同一段改了几个字,配成一对
 * 「修改」,再在行内按词比一次 —— 研报更新多半是改数字、补一句话,
 * 整段标红标绿看不出改了哪儿。
 */

export interface MdLine {
  text: string
  /** 是 markdown 标题(代码块里的 # 不算) */
  heading: boolean
  /** 在代码块里(含围栏行):ASCII 走势图要等宽、不折行才看得出形状 */
  code: boolean
}

export interface InlinePart {
  text: string
  op: 'same' | 'add' | 'del'
}

type RowBody =
  | { kind: 'same' | 'add' | 'del'; line: MdLine }
  /** 标题行的 parts 不含 # 前缀 */
  | { kind: 'mod'; old: MdLine; line: MdLine; parts: InlinePart[] }

/** section:这一行所属章节(上方最近的标题) */
export type DiffRow = RowBody & { section: string }

const HEADING = /^#{1,6}\s/
const FENCE = /^\s*(```|~~~)/

export function splitLines(md: string): MdLine[] {
  const out: MdLine[] = []
  let inFence = false
  for (const raw of md.split(/\r?\n/)) {
    const text = raw.trimEnd()
    const fence = FENCE.test(text)
    if (fence) inFence = !inFence
    if (text.trim() === '') continue
    out.push({ text, heading: !inFence && HEADING.test(text), code: inFence || fence })
  }
  return out
}

/** 标题行去掉 # 前缀,作章节名 */
export function headingTitle(text: string): string {
  return text.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim()
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('zh', { granularity: 'word' })
  : null

/** 按词切。中文靠 Intl.Segmenter 分词;没有的环境退回逐字。 */
function tokenize(s: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(s), x => x.segment)
  return Array.from(s)
}

/** 行内按词对比,相邻同类片段合并 */
export function inlineDiff(a: string, b: string): InlinePart[] {
  const parts: InlinePart[] = []
  for (const c of diffArrays(tokenize(a), tokenize(b))) {
    const op = c.added ? 'add' : c.removed ? 'del' : 'same'
    const text = c.value.join('')
    const last = parts[parts.length - 1]
    if (last && last.op === op) last.text += text
    else parts.push({ text, op })
  }
  return parts
}

/** 两行有多像:不变部分的字数占两行平均长度的比例,0..1 */
function similarity(parts: InlinePart[], a: string, b: string): number {
  const total = a.length + b.length
  if (total === 0) return 1
  const same = parts.reduce((n, p) => (p.op === 'same' ? n + p.text.length : n), 0)
  return (2 * same) / total
}

/**
 * 两行比一次:行内片段 + 相似度。
 * 标题只比去掉 # 之后的名字 —— 共有的「## 」会把两个不相干的章节名凑过相似度线,
 * 显示时也不需要它。
 */
function compareLines(a: MdLine, b: MdLine): { parts: InlinePart[]; score: number } {
  const x = a.heading ? headingTitle(a.text) : a.text
  const y = b.heading ? headingTitle(b.text) : b.text
  const parts = inlineDiff(x, y)
  return { parts, score: similarity(parts, x, y) }
}

/** 低于这个相似度就当成「删一段、加一段」,不硬配成修改 */
const PAIR_THRESHOLD = 0.5
/** 一个删除行最多往后找几个新增行去配对 —— 限住大段改写时的计算量 */
const PAIR_WINDOW = 8

/** 把一段连续的删除行和紧跟的新增行配对成修改 */
function pairRun(dels: MdLine[], adds: MdLine[]): RowBody[] {
  const rows: RowBody[] = []
  let j = 0
  for (const d of dels) {
    let best: { k: number; parts: InlinePart[]; score: number } | null = null
    for (let k = j; k < Math.min(adds.length, j + PAIR_WINDOW); k++) {
      // 标题只和标题配,正文只和正文配
      if (adds[k].heading !== d.heading) continue
      const { parts, score } = compareLines(d, adds[k])
      if (score >= PAIR_THRESHOLD && (!best || score > best.score)) best = { k, parts, score }
    }
    if (!best) {
      rows.push({ kind: 'del', line: d })
      continue
    }
    for (; j < best.k; j++) rows.push({ kind: 'add', line: adds[j] })
    rows.push({ kind: 'mod', old: d, line: adds[best.k], parts: best.parts })
    j = best.k + 1
  }
  for (; j < adds.length; j++) rows.push({ kind: 'add', line: adds[j] })
  return rows
}

export function diffMarkdown(oldMd: string, newMd: string): DiffRow[] {
  const changes = diffArrays(splitLines(oldMd), splitLines(newMd), {
    comparator: (a, b) => a.text === b.text,
  })

  const rows: RowBody[] = []
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    if (!c.added && !c.removed) {
      // 两边相同的行:取新版那一份(heading 判定与新版一致)
      for (const line of c.value) rows.push({ kind: 'same', line })
    } else if (c.removed) {
      const next = changes[i + 1]
      const adds = next?.added ? next.value : []
      if (next?.added) i++
      rows.push(...pairRun(c.value, adds))
    } else {
      for (const line of c.value) rows.push({ kind: 'add', line })
    }
  }

  // 每行归到它上方最近的标题下
  let section = ''
  return rows.map(r => {
    if (r.line.heading) section = headingTitle(r.line.text)
    return { ...r, section }
  })
}

export interface DiffStats {
  added: number
  removed: number
  modified: number
}

export function diffStats(rows: DiffRow[]): DiffStats {
  const s = { added: 0, removed: 0, modified: 0 }
  for (const r of rows) {
    if (r.kind === 'add') s.added++
    else if (r.kind === 'del') s.removed++
    else if (r.kind === 'mod') s.modified++
  }
  return s
}

export interface ChangedSection {
  title: string
  /** 标题行本身新增 / 删除 = 整节新增 / 删除 */
  status: 'added' | 'removed' | 'changed'
  /** 这一节第一处改动的行号,用来跳过去 */
  firstRow: number
  changes: number
}

/** 有改动的章节,按出现顺序 */
export function changedSections(rows: DiffRow[]): ChangedSection[] {
  const out: ChangedSection[] = []
  rows.forEach((r, i) => {
    if (r.kind === 'same') return
    const last = out[out.length - 1]
    // 标题行自己有改动就另起一条:同名章节被删了又加回来,也要分开列
    if (last && last.title === r.section && !r.line.heading) {
      last.changes++
      return
    }
    const status = r.line.heading && r.kind === 'add' ? 'added' : r.line.heading && r.kind === 'del' ? 'removed' : 'changed'
    out.push({ title: r.section || '开头', status, firstRow: i, changes: 1 })
  })
  return out
}

export type DiffSegment =
  | { type: 'rows'; start: number; rows: DiffRow[] }
  | { type: 'gap'; start: number; rows: DiffRow[] }

/**
 * 只看改动时的分段:改动前后各留 `context` 行上下文,
 * 中间成片没改的行折成一个 gap(界面上可以点开)。
 */
export function segment(rows: DiffRow[], context = 2): DiffSegment[] {
  const keep = rows.map(() => false)
  rows.forEach((r, i) => {
    if (r.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true
  })
  const out: DiffSegment[] = []
  rows.forEach((r, i) => {
    const type = keep[i] ? 'rows' : 'gap'
    const last = out[out.length - 1]
    if (last && last.type === type) last.rows.push(r)
    else out.push({ type, start: i, rows: [r] })
  })
  return out
}

/** 对比页链接 */
export function diffHref(docId: string, from: number, to: number): string {
  return `/reports/${docId}/diff?from=${from}&to=${to}`
}

/** 拿 viewing 去比的那一对:和它的上一版比;它本身是第一版就和下一版比 */
export function diffPairFor(versions: { version: number }[], viewing: number): [number, number] {
  const i = versions.findIndex(v => v.version === viewing)
  if (i > 0) return [versions[i - 1].version, viewing]
  return [viewing, versions[i + 1]?.version ?? viewing]
}
