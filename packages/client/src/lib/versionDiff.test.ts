import { describe, it, expect } from 'vitest'
import { changedSections, diffMarkdown, diffStats, inlineDiff, segment, splitLines } from './versionDiff'

describe('splitLines', () => {
  it('去掉空行,识别标题,代码块里的 # 不算标题', () => {
    const lines = splitLines('# 标题\n\n正文\n\n```\n# 注释\n```\n## 二级  \n')
    expect(lines.map(l => l.text)).toEqual(['# 标题', '正文', '```', '# 注释', '```', '## 二级'])
    expect(lines.map(l => l.heading)).toEqual([true, false, false, false, false, true])
    expect(lines.map(l => l.code)).toEqual([false, false, true, true, true, false])
  })
})

describe('inlineDiff', () => {
  it('只标出改了的数字', () => {
    const parts = inlineDiff('营收增长 12%,毛利率 40%', '营收增长 15%,毛利率 40%')
    expect(parts.filter(p => p.op === 'del').map(p => p.text).join('')).toBe('12')
    expect(parts.filter(p => p.op === 'add').map(p => p.text).join('')).toBe('15')
    expect(parts.filter(p => p.op !== 'add').map(p => p.text).join('')).toBe('营收增长 12%,毛利率 40%')
    expect(parts.filter(p => p.op !== 'del').map(p => p.text).join('')).toBe('营收增长 15%,毛利率 40%')
  })
})

describe('diffMarkdown', () => {
  const v1 = [
    '# 报告',
    '## 一、结论',
    '目标价 100 元,维持买入评级。',
    '## 二、风险',
    '原材料涨价。',
    '| 年份 | 营收 |',
    '|---|---|',
    '| 2025 | 10 |',
  ].join('\n\n')

  it('同一版本没有改动', () => {
    const rows = diffMarkdown(v1, v1)
    expect(rows.every(r => r.kind === 'same')).toBe(true)
    expect(changedSections(rows)).toEqual([])
  })

  it('改几个字配成修改,整段换掉算删 + 加', () => {
    const v2 = v1
      .replace('目标价 100 元', '目标价 120 元')
      .replace('原材料涨价。', '海外需求不及预期,订单可能推迟到明年下半年。')
    const rows = diffMarkdown(v1, v2)
    const changed = rows.filter(r => r.kind !== 'same')
    expect(changed.map(r => r.kind)).toEqual(['mod', 'del', 'add'])
    expect(changed[0].section).toBe('一、结论')
    expect(changed[1].section).toBe('二、风险')
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1, modified: 1 })
  })

  it('表格只标出改动的那一行', () => {
    const v2 = v1 + '\n| 2026 | 14 |'
    const changed = diffMarkdown(v1, v2).filter(r => r.kind !== 'same')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ kind: 'add', line: { text: '| 2026 | 14 |' } })
  })

  it('新增 / 删除整节', () => {
    const v2 = v1.replace('## 二、风险\n\n原材料涨价。', '## 三、估值\n\n给 20 倍 PE。')
    const sections = changedSections(diffMarkdown(v1, v2))
    expect(sections.map(s => [s.title, s.status])).toEqual([
      ['二、风险', 'removed'],
      ['三、估值', 'added'],
    ])
  })

  it('标题改名算修改,不和正文配对', () => {
    const v2 = v1.replace('## 一、结论', '## 一、核心结论')
    const changed = diffMarkdown(v1, v2).filter(r => r.kind !== 'same')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ kind: 'mod', section: '一、核心结论' })
    expect(changedSections(diffMarkdown(v1, v2))).toMatchObject([{ title: '一、核心结论', status: 'changed', changes: 1 }])
  })
})

describe('segment', () => {
  it('改动前后留上下文,中间折叠', () => {
    const a = Array.from({ length: 20 }, (_, i) => `第${i}段`).join('\n')
    const b = a.replace('第10段', '第10段改')
    const segs = segment(diffMarkdown(a, b), 2)
    expect(segs.map(s => [s.type, s.start, s.rows.length])).toEqual([
      ['gap', 0, 8],
      ['rows', 8, 5],
      ['gap', 13, 7],
    ])
  })
})
