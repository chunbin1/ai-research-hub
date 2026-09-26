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

describe('ReportMarkdown — 宽表与数字列', () => {
  const scan = `| 公司 | 代码 | 股价 | 市值 | PS | 净利 | 环节 |
| --- | --- | --- | --- | --- | --- | --- |
| SpaceX | SPCX | $114.53 | $1,508亿×10=$1.51万亿 | 78x | -$93.6亿 | 发射+星座+AI |
| Rocket Lab | RKLB | $70.43 | $421亿 | **62x** | -$1.83亿 | 发射+整星 |
| Relativity | 未上市 | — | — | — | N/A | 发射 |
`

  it('6 列起:桌面那份表格标成宽表,不受正文版心限制', () => {
    const { container } = render(<ReportMarkdown markdown={scan} />)
    expect(container.querySelector('.md-wide table')).not.toBeNull()
  })

  it('5 列以内不是宽表', () => {
    const { container } = render(<ReportMarkdown markdown={fixture} />)
    expect(container.querySelector('.md-wide')).toBeNull()
  })

  it('整列都是数字的列挂 num(表头也挂),文字列和首列不挂', () => {
    const { container } = render(<ReportMarkdown markdown={scan} />)
    const header = [...container.querySelectorAll('thead th')].map(th => th.classList.contains('num'))
    // 公司 代码 股价 市值 PS 净利 环节
    expect(header).toEqual([false, false, true, true, true, true, false])
    const firstRow = [...container.querySelectorAll('tbody tr')[0].children].map(td => td.classList.contains('num'))
    expect(firstRow).toEqual(header)
    // 单元格里的加粗原样保留
    expect(container.querySelector('tbody td.num strong')?.textContent).toBe('62x')
  })
})
