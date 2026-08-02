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
