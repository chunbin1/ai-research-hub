import { Children, cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'

/**
 * 移动端表格改排卡片的列数门槛。2–3 列的表在 390px 宽的屏上还放得下,
 * 硬拆成卡片反而更难横向比较;4 列起横滑就看不全一行了,才值得改排。
 */
const CARD_MIN_COLS = 4

/**
 * 桌面端「宽表」的列数门槛:6 列起的表不受正文版心限制,吃满内容区宽度
 * (`.md-wide`,见 index.css)。9 列的上市公司扫描表挤在版心里,价格、市值
 * 全折成两三行;5 列以内在版心里放得下,留在版心里和正文对齐更整齐。
 */
const WIDE_MIN_COLS = 6

/**
 * 数字单元格:可带正负号 / 约数符号 / 币种符号,紧跟着是数字。
 * 「$114.53」「-$93.6亿」「290x」「30-45%(估计)」「2026-08-06」都算。
 */
const NUMERIC_CELL = /^[+\-−±~≈约]?\s*[$¥€£]?\s*\d/
/** 太长的就不是「一个数」了,是一句带数字开头的话,该折行还得折 */
const NUMERIC_MAX_LEN = 24
/** 缺数据的占位写法:判定数字列时当空格跳过(未上市公司那几行股价、市值全是「—」) */
const PLACEHOLDER_CELL = /^(?:[—–\-]+|n\/?a|未披露|暂无|无)$/i

type CellElement = ReactElement<{ children?: ReactNode; className?: string }>

/** 取一个 thead / tbody / tr 元素下的子元素,丢掉 react-markdown 留下的换行文本节点 */
function elementChildren(node: ReactNode): CellElement[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return Children.toArray(node.props.children).filter(isValidElement) as CellElement[]
}

/** 单元格的纯文本(加粗、链接等行内格式里的字也算上) */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/**
 * 哪几列是数字列:这一列所有有值的单元格都是「一个数」(占位的「—」不算)。首列是行名,不算。
 * 数字列右对齐、不折行、用等宽数字(td.num / th.num),上下行好比大小。
 */
function numericColumns(rows: ReactNode[][], cols: number): Set<number> {
  const out = new Set<number>()
  for (let c = 1; c < cols; c++) {
    const values = rows.map(r => textOf(r[c]).trim()).filter(v => v && !PLACEHOLDER_CELL.test(v))
    if (values.length > 0 && values.every(v => v.length <= NUMERIC_MAX_LEN && NUMERIC_CELL.test(v))) out.add(c)
  }
  return out
}

/**
 * 表格:桌面照常是表格;移动端列数够多时额外出一份卡片排版,
 * 用 hidden / md:hidden 切换同一份数据(display:none 的那份读屏不会重复播报)。
 *
 * 卡片直接从 react-markdown 已经渲染好的 thead/tbody 子元素里取单元格内容,
 * 这样单元格里的加粗、链接、行内代码原样保留,不需要再解析一遍 hast。
 * 首列当卡片标题,其余列按「表头:值」逐行列出;表头为空的列只出值。
 */
const Table: Components['table'] = ({ children }) => {
  const sections = Children.toArray(children).filter(isValidElement) as CellElement[]
  const thead = sections.find(s => s.type === 'thead')
  const tbody = sections.find(s => s.type === 'tbody')
  const headRow = thead ? elementChildren(thead)[0] : undefined
  const headers = headRow ? elementChildren(headRow).map(th => th.props.children) : []
  const rows = tbody ? elementChildren(tbody).map(tr => elementChildren(tr).map(td => td.props.children)) : []

  // 数字列给表头和单元格都挂上 num:在已经渲染好的 th / td 上补 className,
  // 单元格里的行内格式不受影响
  const numCols = numericColumns(rows, headers.length)
  const markRow = (tr: CellElement) => cloneElement(tr, undefined, elementChildren(tr).map((cell, i) =>
    numCols.has(i) ? cloneElement(cell, { className: 'num' }) : cell))
  const body = numCols.size === 0
    ? children
    : sections.map(s => cloneElement(s, undefined, elementChildren(s).map(markRow)))

  const wide = headers.length >= WIDE_MIN_COLS ? ' md-wide' : ''
  const table = <div className={`md-table-scroll${wide}`}><table>{body}</table></div>
  if (headers.length < CARD_MIN_COLS || rows.length === 0) return table

  return (
    <>
      <div className={`hidden md:block${wide}`}>{table}</div>
      <div className="md-cards md:hidden">
        {rows.map((cells, i) => (
          <section key={i} className="md-card">
            <div className="md-card-title">{cells[0]}</div>
            <dl>
              {cells.slice(1).map((cell, j) => (
                <div key={j} className="md-card-row">
                  {headers[j + 1] ? <dt>{headers[j + 1]}</dt> : null}
                  <dd>{cell}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}

const components: Components = { table: Table }

export default function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
      {markdown}
    </Markdown>
  )
}
