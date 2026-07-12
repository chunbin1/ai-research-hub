import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'

export default function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
      {markdown}
    </Markdown>
  )
}
