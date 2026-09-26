import { Children, isValidElement } from 'react'
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

type CellElement = ReactElement<{ children?: ReactNode }>

/** 取一个 thead / tbody / tr 元素下的子元素,丢掉 react-markdown 留下的换行文本节点 */
function elementChildren(node: ReactNode): CellElement[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return Children.toArray(node.props.children).filter(isValidElement) as CellElement[]
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

  const table = <div className="md-table-scroll"><table>{children}</table></div>
  if (headers.length < CARD_MIN_COLS || rows.length === 0) return table

  return (
    <>
      <div className="hidden md:block">{table}</div>
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
