import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPath, excerpt, renderHead, robotsTxt, sitemapXml } from './seo.ts'

const SITE = 'https://example.test'

test('classifyPath:首页 / 信号 / 研报页可收录,其余一律 noindex', () => {
  assert.deepEqual(classifyPath(''), { kind: 'home' })
  assert.deepEqual(classifyPath('/'), { kind: 'home' })
  assert.deepEqual(classifyPath('?kind=company'), { kind: 'home' })
  assert.deepEqual(classifyPath('signals'), { kind: 'signals' })
  assert.deepEqual(classifyPath('reports/doc_1_ab'), { kind: 'report', id: 'doc_1_ab' })
  assert.deepEqual(classifyPath('/reports/doc_1_ab?version=2'), { kind: 'report', id: 'doc_1_ab' })
  // import:raw 的 id 取自文件名,可能带中文或 .
  assert.deepEqual(classifyPath(`reports/${encodeURIComponent('茅台')}`), { kind: 'report', id: '茅台' })
  assert.deepEqual(classifyPath('reports/doc_1.v2'), { kind: 'report', id: 'doc_1.v2' })
  for (const p of ['reports/..%2F..%2Fadmin', 'reports/a%2Fb', 'reports/a%5Cb', 'reports/..', 'admin', 'settings', 'traces', 'traces/t1', 'eval', 'eval/doc_1', 'reports/doc_1/diff', 'nope']) {
    assert.deepEqual(classifyPath(p), { kind: 'noindex' }, p)
  }
})

test('excerpt:跳过标题和开头的引用块,取第一个普通段落', () => {
  const md = [
    '# 碳酸锂产业链投资研究报告',
    '',
    '> 研究框架:产业链全景扫描',
    '> ⚠️ 免责声明:非投资建议',
    '',
    '---',
    '',
    '## 执行摘要',
    '',
    '**一句话定性**:碳酸锂是一门**典型的强周期**生意,',
    '它不是[好生意](https://x.test)。',
  ].join('\n')
  assert.equal(excerpt(md), '一句话定性:碳酸锂是一门典型的强周期生意,它不是好生意。')
})

test('excerpt:跳过一行一个字段的元信息块,单行的加粗标签句照常保留', () => {
  const md = '**报告日期**:2026-08-01\n**数据基准**:2025 年年报\n\n**一句话**:内存成了稀缺资源。'
  assert.equal(excerpt(md), '一句话:内存成了稀缺资源。')
})

test('excerpt:空行隔开的单个字段也跳过', () => {
  const md = '**报告日期**:2026-08-01\n\n**数据基准**:2025 年年报\n\n锂价完成了第二次探底。'
  assert.equal(excerpt(md), '锂价完成了第二次探底。')
})

test('excerpt:整行加粗的字段和小标题跳过,整行加粗的句子保留', () => {
  assert.equal(excerpt('**信息丰富度评级:A级(信息极度充裕)**\n\n**核心结论**\n\n茅台被研究得最透彻。'), '茅台被研究得最透彻。')
  assert.equal(excerpt('**锂价将在 2027 年见底。**'), '锂价将在 2027 年见底。')
})

test('excerpt:标题和首段之间没有空行,照样取到首段', () => {
  assert.equal(excerpt('# 锂资源回顾\n锂价完成了第二次探底。'), '锂价完成了第二次探底。')
})

test('excerpt:分隔线和 setext 标题紧跟正文时按行去掉', () => {
  assert.equal(excerpt('---\n锂价完成了第二次探底。'), '锂价完成了第二次探底。')
  assert.equal(excerpt('标题\n===\n\n正文。'), '正文。')
  assert.equal(excerpt('小节\n---\n正文。'), '正文。')
})

test('excerpt:字段行和正文同段时按行去掉;冒号在加粗里、加粗后还跟着说明的也算字段', () => {
  assert.equal(excerpt('**报告日期**:2026-08-01\n锂价完成了第二次探底。'), '锂价完成了第二次探底。')
  const md = [
    '# Ginkgo 投资研究报告',
    '',
    '**报告日期:2026年10月6日**(价格数据截至 10月5日收盘)',
    '**研究框架:四大师综合分析**',
    '**前序研究**:[合成生物学](../a.md)(一个月前给出 ★★☆☆☆)',
    '',
    '自主实验室是真实存在的新业务。',
  ].join('\n')
  assert.equal(excerpt(md), '自主实验室是真实存在的新业务。')
})

test('excerpt:表格下的出处说明不当正文', () => {
  assert.equal(excerpt('| a |\n|---|\n\n来源:SEC XBRL;10-K 第 70 页。\n\n*注:单位百万美元。*\n\n营收连续三年下滑。'), '营收连续三年下滑。')
})

test('excerpt:段落中间夹的引用行不拼进摘要', () => {
  assert.equal(excerpt('营收 9501 万。\n> ⚠️ 别用 TTM 口径'), '营收 9501 万。')
})

test('excerpt:加粗只是句首强调、后面接着正文的行不当字段', () => {
  assert.equal(excerpt('**重点**在于现金流是否转正'), '重点在于现金流是否转正')
})

test('excerpt:跳过表格和代码块;英文换行合成空格', () => {
  const md = '| a | b |\n|---|---|\n\n```\ncode\n```\n\nRevenue grew\n`fast` this year.'
  assert.equal(excerpt(md), 'Revenue grew fast this year.')
})

test('excerpt:没有普通段落时退回引用块', () => {
  assert.equal(excerpt('# T\n\n> 只有一段引用\n> 第二行'), '只有一段引用第二行')
})

test('excerpt:超长截断并加省略号,按字符而不是 UTF-16 码元数', () => {
  const out = excerpt('锂'.repeat(500), 10)
  assert.equal(out, `${'锂'.repeat(9)}…`)
})

test('renderHead:值全部转义,研报标题不能闭合标签', () => {
  const html = renderHead({ title: '</title><script>x</script>', description: 'a "b"', url: `${SITE}/reports/x` }, SITE)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;'))
  assert.ok(html.includes('content="a &quot;b&quot;"'))
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/reports/x" />`))
})

test('renderHead:noindex 页只出标题和 robots,不出 canonical', () => {
  const html = renderHead({ title: '研报站', noindex: true }, SITE)
  assert.ok(html.includes('<meta name="robots" content="noindex" />'))
  assert.ok(!html.includes('canonical'))
  assert.ok(!html.includes('og:'))
})

test('robotsTxt:写绝对地址的 sitemap,不拦 /api', () => {
  const txt = robotsTxt(SITE)
  assert.ok(txt.includes(`Sitemap: ${SITE}/sitemap.xml`))
  assert.ok(!/Disallow: \/api/.test(txt))
})

test('sitemapXml:首页 lastmod 取最新一篇,每篇研报一条', () => {
  const xml = sitemapXml(SITE, [
    { id: 'doc_2', updated_at: '2026-10-02T00:00:00.000Z' },
    { id: 'doc_1', updated_at: '2026-10-01T00:00:00.000Z' },
  ])
  assert.ok(xml.includes(`<url><loc>${SITE}/</loc><lastmod>2026-10-02T00:00:00.000Z</lastmod></url>`))
  assert.ok(xml.includes(`<loc>${SITE}/reports/doc_1</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>`))
  assert.equal(xml.match(/<url>/g)?.length, 4)
})
