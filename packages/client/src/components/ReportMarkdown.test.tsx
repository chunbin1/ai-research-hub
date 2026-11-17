import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ReportMarkdown from './ReportMarkdown'
import { extractToc } from '../lib/toc'

/** 屏幕上能看见的字。KaTeX 的 MathML 注释里还留着 LaTeX 源码,不算。 */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex-mathml').forEach(node => node.remove())
  return clone.textContent ?? ''
}

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

  it('收尾 ** 前是全角标点、后面紧跟汉字,也能加粗', () => {
    const md = `| 日期 | 事件 |
| --- | --- |
| 2026-01-08 | **智谱（Z.ai，02513.HK）**在港交所上市 |
`
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('td strong')?.textContent).toBe('智谱（Z.ai，02513.HK）')
    expect(container.textContent).not.toContain('**')
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

describe('ReportMarkdown — 数字列', () => {
  const scan = `| 公司 | 代码 | 股价 | 市值 | PS | 净利 | 环节 |
| --- | --- | --- | --- | --- | --- | --- |
| SpaceX | SPCX | $114.53 | $1,508亿×10=$1.51万亿 | 78x | -$93.6亿 | 发射+星座+AI |
| Rocket Lab | RKLB | $70.43 | $421亿 | **62x** | -$1.83亿 | 发射+整星 |
| Relativity | 未上市 | — | — | — | N/A | 发射 |
`

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

  // 股票代码、日期以数字开头,但不是用来比大小的数
  it('A 股 / 港股代码列、日期列不算数字列', () => {
    const md = `| 公司 | 代码 | 两地代码 | 披露日 | 现价 | PE |
| --- | --- | --- | --- | --- | --- |
| 中国神华 | 601088.SH | 601088/01088.HK | 2026-08-04 | 45.69 | 18.75× |
| 赣锋锂业 | 002460 | 002460/01772.HK | 2026/8/6 | 43.46 | 16.42 |
| 腾讯 | 0700.HK | 0700.HK / TCEHY | 2026年8月 | 520.0 | 22x |
`
    const { container } = render(<ReportMarkdown markdown={md} />)
    const header = [...container.querySelectorAll('thead th')].map(th => th.classList.contains('num'))
    // 公司 代码 两地代码 披露日 现价 PE
    expect(header).toEqual([false, false, false, false, true, true])
  })

  it('表头写明是代码 / 日期的列,即使内容像数字也不算', () => {
    const md = `| 名称 | 证券代码 | 日期 | 金额 |
| --- | --- | --- | --- |
| A | 510300 | 20260804 | 1,203 |
`
    const { container } = render(<ReportMarkdown markdown={md} />)
    const header = [...container.querySelectorAll('thead th')].map(th => th.classList.contains('num'))
    expect(header).toEqual([false, false, false, true])
  })

  it('不带千分位的小数(2949.16)不会被当成日期', () => {
    const md = `| 公司 | 营收(亿元) |
| --- | --- |
| 腾讯 | 2949.16 |
| 网易 | 1052.34 |
`
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('thead th:nth-child(2)')?.classList.contains('num')).toBe(true)
  })
})

describe('ReportMarkdown — 公式', () => {
  const audit = `- **C2（分母宽度 $r - g \\ge 5\\text{ pct}$）**：
  - 悲观档 $g=0.5\\%$：$r-g = \\mathbf{7.5\\text{ pct}}$，退出 PE = **13.0×**（留存率 2.5%，派息率 97.5%）
  - 基准档 $g=1.8\\%$：$r-g = \\mathbf{6.2\\text{ pct}}$，退出 PE = **14.7×**（留存率 9.0%，派息率 91.0%）
  - 乐观档 $g=2.8\\%$：$r-g = \\mathbf{5.2\\text{ pct}}$，退出 PE = **16.5×**（留存率 14.0%，派息率 86.0%）
  - 三档分母宽度均 $\\ge 5.0\\text{ pct}$ → **✓ 通过**。

#### Step 3 & Step 4 — 十年期 IRR 与 $r$ 敏感性翻转测试

经 \`terminal_value.py irr\`（$r=8.00\\%$）：

| 测试维度 | 折现率 $r$ | 期望 IRR |
| --- | --- | --- |
| $\\Delta r = \\pm 2\\text{ pp}$ 下沿 | 6.00% | +13.08% |
| **基准 $r$** | **8.00%** | **+8.94%** |

在 $\\pm 2\\text{ pp}$ 下，因 $10.0\\%$ 落在区间外。当 $r$ 升至上沿，$r=8\\%\\sim9\\%$，$ROIC=20\\%$，$g=0.5\\%/1.8\\%/2.8\\%$，$\\beta=1.0$。
`

  it('把 $...$ 公式排成数学,不再露出美元符和 LaTeX 命令', () => {
    const { container } = render(<ReportMarkdown markdown={audit} />)
    const visible = visibleText(container)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
    expect(visible).not.toContain('$')
    expect(visible).not.toContain('\\')
    expect(visible).toContain('≥')
    expect(visible).toContain('%')
    expect(visible).toContain('β')
    expect(visible).toContain('13.0×')
    // 行内代码里的文件名还是代码,不进公式
    expect(container.querySelector('code')?.textContent).toBe('terminal_value.py irr')
  })

  it('标题里的 $r$ 排成公式后,锚点仍与目录一致', () => {
    const md = '#### Step 3 & Step 4 — 十年期 IRR 与 $r$ 敏感性翻转测试\n'
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('h4 .katex')).not.toBeNull()
    expect(container.querySelector('h4')?.id).toBe(extractToc(md)[0].slug)
  })

  it('金额里的 $ 保持原样,不拿去和后面的 $ 配成公式', () => {
    const md = `| 公司 | 股价 | 市值 |
| --- | --- | --- |
| SpaceX | $114.53 | $1,508亿×10=$1.51万亿 |
`
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(visibleText(container)).toContain('$114.53')
    expect(visibleText(container)).toContain('$1,508亿×10=$1.51万亿')
  })

  it('代码块和行内代码里的 $公式$ 保持原样', () => {
    const md = '正文 $r$ 与 `$r$`。\n\n```\n$r - g \\ge 5\\text{ pct}$\n```\n'
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(container.querySelector('pre')?.textContent).toContain('$r - g \\ge 5\\text{ pct}$')
    expect(container.querySelector('p code')?.textContent).toBe('$r$')
  })

  it('同一行里金额在公式前面时,公式仍排版,金额仍是美元符', () => {
    const md = '市值 $1.5B，折现率 $r$，总价 $200。\n\n| 金额 | 折现率 |\n| --- | --- |\n| $100 | $r$ |\n'
    const { container } = render(<ReportMarkdown markdown={md} />)
    const visible = visibleText(container)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(visible).toContain('$1.5B')
    expect(visible).toContain('$200')
    expect(visible).toContain('$100')
    expect(visible).not.toContain('\\')
  })

  it('无反斜杠的算式和下标也排成公式', () => {
    const md = '分母 $r - g$ 与无风险利率 $r_f$。'
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(visibleText(container)).not.toContain('$')
  })

  it('独立成行的 $$ 公式排成块级公式', () => {
    const md = '$$\nr - g \\ge 5\\text{ pct}\n$$\n'
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(visibleText(container)).not.toContain('$')
    expect(visibleText(container)).toContain('≥')
  })

  it('段落里的 $$...$$ 仍按公式解析,不转义成美元符', () => {
    const md = '同行 $$E=mc^2$$。\n'
    const { container } = render(<ReportMarkdown markdown={md} />)
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(visibleText(container)).not.toContain('$')
  })

  it('原文里已经转义的 \\$ 不再多加一道反斜杠', () => {
    const md = '成本为 \\$100。'
    const { container } = render(<ReportMarkdown markdown={md} />)
    const visible = visibleText(container)
    expect(container.querySelector('.katex')).toBeNull()
    expect(visible).toContain('$100')
    expect(visible).not.toContain('\\')
  })
})
