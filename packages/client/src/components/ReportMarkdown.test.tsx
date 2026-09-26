import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ReportMarkdown from './ReportMarkdown'

// .report-body 补偿层(index.css)已经静默失效过一次(标题粗体 / 列表间距被 preflight
// 抹掉却没人发现)。这个测试不校验具体数值——那是 index.css 里注释说明的职责——
// 只兜底「标签有没有被正确渲染出来」这种更粗暴的回归:class 挂漏、规则被误删。
const fixture = `## 二级标题

- 列表项一
- 列表项二

行内代码 \`const x = 1\` 示例,以及一个[链接](https://example.com)。

| 列 A | 列 B |
| --- | --- |
| 1   | 2   |
`

describe('ReportMarkdown', () => {
  it('渲染出标题 / 列表 / 链接 / 表格 / 行内代码', () => {
    const { container } = render(<ReportMarkdown markdown={fixture} />)

    expect(container.querySelector('h2')).not.toBeNull()
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('code')).not.toBeNull()
  })
})

describe('ReportMarkdown — 移动端表格卡片', () => {
  const wide = `| 偏见类型 | 表现 | 应对 | 置信度 |
| --- | --- | --- | --- |
| 叙事偏好 | 故事**顺滑** | 用行业增速校准 | A |
| 龙头偏好 | 资料多 | 引入对照线 | B |
`

  it('≥4 列:表格之外再出一份卡片,首列作标题、其余列「表头 值」', () => {
    const { container } = render(<ReportMarkdown markdown={wide} />)
    expect(container.querySelector('table')).not.toBeNull()
    const cards = container.querySelectorAll('.md-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].querySelector('.md-card-title')?.textContent).toBe('叙事偏好')
    const rows = [...cards[0].querySelectorAll('.md-card-row')].map(r => [
      r.querySelector('dt')?.textContent, r.querySelector('dd')?.textContent,
    ])
    expect(rows).toEqual([['表现', '故事顺滑'], ['应对', '用行业增速校准'], ['置信度', 'A']])
    // 单元格里的行内格式原样保留
    expect(cards[0].querySelector('dd strong')?.textContent).toBe('顺滑')
  })

  it('3 列及以下只出表格', () => {
    const { container } = render(<ReportMarkdown markdown={fixture} />)
    expect(container.querySelector('.md-cards')).toBeNull()
  })
})
