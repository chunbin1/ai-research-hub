// packages/server/src/services/mcpServer.ts
//
// 给外部 AI(Claude / Codex / Grok)用的 MCP 工具。
// 读工具和公开的 GET /documents、GET /signals 一样,不鉴权。
// 上传工具只在这次请求带对了 MCP_UPLOAD_KEY 时注册(见 routes/mcp.ts)。
//
// 不做全库检索:模型先 get_report_outline 看目录,再按章节 read_report。
// 研报动辄三五万字,整篇塞进上下文又慢又贵,按章节读是这里唯一的「检索」。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getAllDocuments, getDocument, readRawMarkdown, readVersionMarkdown, saveDocument } from './documentStore.js'
import { listVersions, latestVersion } from './versionStore.js'
import { outlineOf, parseMarkdown, INTRO_SLUG } from './markdownParser.js'
import { signalBoard } from './signals/board.js'
import { isSignalsEnabled } from './signals/scanner.js'
import { getDb } from './db.js'
import { inferKind, type ReportKind } from './reportKind.js'
import { findSimilarUploads, publishVersion, NOTE_MAX, type PublishLog } from './publishReport.js'
import type { Document, DocumentVersion } from '../types.js'

/** 单次 read_report 最多返回的字数。中文约一字一 token,Claude Code 默认单次工具输出上限 25k token。 */
export const PAGE_CHARS = 20000

/** upload_report 接受的正文上限。更长的在工具里拒绝,不落库。 */
export const MARKDOWN_MAX_CHARS = 1_000_000

const READ_INSTRUCTIONS =
  '研报站的只读接口。典型用法:list_reports 找到研报 id → get_report_outline 看目录 → ' +
  'read_report 按 section 读相关章节。回答时引用章节,并附上返回结果里的 url,方便用户跳回原文。'

const WRITE_INSTRUCTIONS =
  READ_INSTRUCTIONS +
  ' 本次连接可以上传:upload_report 写入一篇新的 markdown 研报。' +
  '库里有疑似旧篇时不会落库,结果里有候选 id 和链接;用户确认这是另一篇之后,再带 confirmNew=true 调用。' +
  '不要用它覆盖已有研报。'

const KIND_LABEL = { industry: '行业', company: '公司' } as const

function siteUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

/** 阅读页链接。最新版不带 ?v=,和阅读页自己切回最新版时的地址一致。 */
export function reportUrl(id: string, version?: number, latest?: number, slug?: string): string {
  const v = version !== undefined && version !== latest ? `?v=${version}` : ''
  return `${siteUrl()}/reports/${encodeURIComponent(id)}${v}${slug ? `#${encodeURIComponent(slug)}` : ''}`
}

type Loaded =
  | { ok: true; doc: Document; md: string; version: number; latest: number; versions: DocumentVersion[] }
  | { ok: false; error: string }

/** 与 GET /documents/:id 同一套取版本规则 */
function load(id: string, version?: number): Loaded {
  const doc = getDocument(id)
  if (!doc) return { ok: false, error: `找不到研报 ${id}。先调 list_reports 拿 id。` }
  const db = getDb()
  const versions = listVersions(db, doc.id)
  if (versions.length === 0) {
    if (version !== undefined && version !== 1) return { ok: false, error: `研报 ${id} 没有 v${version}` }
    return { ok: true, doc, md: readRawMarkdown(doc.id) ?? '', version: 1, latest: 1, versions }
  }
  const latest = latestVersion(db, doc.id) ?? 1
  const v = version ?? latest
  if (!versions.some(x => x.version === v)) {
    return { ok: false, error: `研报 ${id} 没有 v${v},现有版本:${versions.map(x => `v${x.version}`).join('、')}` }
  }
  return { ok: true, doc, md: readVersionMarkdown(doc.id, v) ?? '', version: v, latest, versions }
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const json = (o: unknown) => text(JSON.stringify(o, null, 2))
const fail = (s: string) => ({ ...text(s), isError: true })

const silentLog: PublishLog = { info() {}, warn() {} }

export interface McpServerOptions {
  /** 这次请求带对了 MCP_UPLOAD_KEY。为 true 才注册 upload_report。 */
  write?: boolean
  log?: PublishLog
}

export function buildMcpServer(opts: McpServerOptions = {}): McpServer {
  const log = opts.log ?? silentLog
  const server = new McpServer(
    { name: 'ai-research-hub', version: '0.1.0' },
    { instructions: opts.write ? WRITE_INSTRUCTIONS : READ_INSTRUCTIONS },
  )

  server.registerTool('list_reports', {
    title: '列出研报',
    description: '列出站里所有研报,最近更新的在前。返回 id、标题、类型(行业/公司)、最新版本号、更新时间和阅读页链接。',
    inputSchema: { kind: z.enum(['industry', 'company']).optional().describe('只看行业研报或公司研报;不传就是全部') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ kind }) => {
    const docs = getAllDocuments().filter(d => !kind || d.kind === kind)
    return json(docs.map(d => ({
      id: d.id,
      title: d.filename,
      kind: KIND_LABEL[d.kind],
      latestVersion: d.latest_version,
      updatedAt: d.updated_at,
      url: reportUrl(d.id),
    })))
  })

  server.registerTool('get_report_outline', {
    title: '研报目录',
    description:
      '一篇研报的章节目录(层级、标题、slug、每节字数)和版本历史。读正文前先看目录,再用 read_report 按 slug 只读需要的章节。' +
      `首个标题之前若有引言,目录第一条是 level 0、slug 为 ${INTRO_SLUG} 的「引言」。`,
    inputSchema: {
      id: z.string().describe('研报 id,来自 list_reports'),
      version: z.number().int().positive().optional().describe('版本号;不传就是最新版'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, version }) => {
    const r = load(id, version)
    if (!r.ok) return fail(r.error)
    return json({
      id: r.doc.id,
      title: r.versions.find(v => v.version === r.version)?.filename ?? r.doc.filename,
      kind: KIND_LABEL[r.doc.kind],
      version: r.version,
      latestVersion: r.latest,
      totalChars: r.md.length,
      url: reportUrl(r.doc.id, r.version, r.latest),
      versions: r.versions.map(v => ({ version: v.version, uploadedAt: v.created_at, note: v.note })),
      outline: outlineOf(r.md).map(o => ({ level: o.level, title: o.title, slug: o.slug, chars: o.end - o.start })),
    })
  })

  server.registerTool('read_report', {
    title: '读研报',
    description:
      `读研报正文(markdown)。传 section 只读那一节(含子节),不传读全文。` +
      `单次最多返回 ${PAGE_CHARS} 字,没读完时结果开头会给出下一次的 offset。`,
    inputSchema: {
      id: z.string().describe('研报 id,来自 list_reports'),
      section: z.string().optional().describe('章节 slug,来自 get_report_outline'),
      version: z.number().int().positive().optional().describe('版本号;不传就是最新版'),
      offset: z.number().int().min(0).optional().describe('从第几个字开始读,分页用;默认 0'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, section, version, offset = 0 }) => {
    const r = load(id, version)
    if (!r.ok) return fail(r.error)
    let body = r.md
    if (section) {
      const hit = outlineOf(r.md).find(o => o.slug === section)
      if (!hit) return fail(`研报 ${id} v${r.version} 里没有章节 ${section}。用 get_report_outline 查可用的 slug。`)
      body = r.md.slice(hit.start, hit.end)
    }
    if (offset > 0 && offset >= body.length) {
      return fail(`offset ${offset} 超出范围:${section ? `章节 ${section}` : '全文'}共 ${body.length} 字。`)
    }
    const page = body.slice(offset, offset + PAGE_CHARS)
    const end = offset + page.length
    const head = [
      `研报:${r.doc.filename}(v${r.version}${r.version === r.latest ? ',最新版' : `,最新是 v${r.latest}`})`,
      // 引言在阅读页上没有锚点,链到篇首
      `链接:${reportUrl(r.doc.id, r.version, r.latest, section === INTRO_SLUG ? undefined : section)}`,
      end < body.length
        ? `本次返回第 ${offset}–${end} 字,共 ${body.length} 字。继续读传 offset=${end}。`
        : offset > 0 ? `本次返回第 ${offset}–${end} 字,已读完。` : null,
    ].filter(Boolean).join('\n')
    return text(`${head}\n\n---\n\n${page}`)
  })

  if (opts.write) registerUpload(server, log)

  if (isSignalsEnabled()) {
    server.registerTool('get_signals', {
      title: '股票信号',
      description:
        '自选股(从研报标题抽出的美股/港股)的日线与周线 SuperTrend 当前状态:趋势方向(1 多 / -1 空)、止损线、' +
        '距止损线百分比、最近一次翻转的日期与价格、近 90 天日线翻转次数,以及来源研报。最近翻转的排最前。',
      inputSchema: { symbol: z.string().optional().describe('只看这一只,如 ALB、0700.HK;不传就是全部') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ symbol }) => {
      const rows = signalBoard()
        .filter(r => r.enabled)
        .filter(r => !symbol || r.symbol.toUpperCase() === symbol.trim().toUpperCase())
      if (symbol && rows.length === 0) return fail(`自选股里没有 ${symbol}`)
      return json(rows.map(({ enabled: _e, lastError: _l, ...r }) => ({
        ...r,
        sourceDoc: r.sourceDoc ? { ...r.sourceDoc, url: reportUrl(r.sourceDoc.id) } : null,
      })))
    })
  }

  return server
}

function similarReasons(c: { titleMatch: 'same' | 'similar' | null; contentMatch: boolean }): string[] {
  const reasons: string[] = []
  if (c.titleMatch === 'same') reasons.push('标题相同')
  else if (c.titleMatch === 'similar') reasons.push('标题相近')
  if (c.contentMatch) reasons.push('正文重合')
  if (reasons.length === 0) reasons.push('主题相近')
  return reasons
}

function registerUpload(server: McpServer, log: PublishLog): void {
  server.registerTool('upload_report', {
    title: '上传新研报',
    description:
      '上传一篇新的 markdown 研报,不是给已有研报加版本,也不能删除或改类型。' +
      '正文放在 markdown。没有一级标题时必须传 title,作为展示名;有一级标题时以标题为准。' +
      'kind 不传则按标题推断,推断不出算行业研报。' +
      '库里有疑似同一篇时不会写入,并返回候选 id、标题、链接和相似原因;确认是另一篇后再带 confirmNew=true。' +
      `正文最多 ${MARKDOWN_MAX_CHARS} 字,版本说明超过 ${NOTE_MAX} 字会被截断。`,
    inputSchema: {
      markdown: z.string().describe('完整 markdown 正文'),
      title: z.string().optional().describe('正文没有一级标题时的展示名'),
      kind: z.enum(['industry', 'company']).optional().describe('行业研报 industry,或公司研报 company;不传则按标题推断'),
      note: z.string().optional().describe(`版本说明,超过 ${NOTE_MAX} 字会被截断`),
      confirmNew: z.boolean().optional().describe('库里有疑似旧篇时,确认仍要新建一篇。默认 false,此时不落库'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ markdown, title, kind, note, confirmNew = false }) => {
    if (markdown.length > MARKDOWN_MAX_CHARS) {
      return fail(`正文超过 ${MARKDOWN_MAX_CHARS} 字,没有写入。`)
    }
    if (!markdown.trim()) return fail('正文是空的,没有写入。')

    const { displayName, chunks } = parseMarkdown(markdown)
    const filename = displayName || (title ?? '').trim()
    if (!filename) return fail('正文没有一级标题,请传 title。没有写入。')

    const resolvedKind: ReportKind = kind ?? inferKind(filename) ?? 'industry'
    const trimmedNote = (note ?? '').trim().slice(0, NOTE_MAX) || null

    if (!confirmNew) {
      const candidates = await findSimilarUploads(
        { title: filename, markdown, kind: resolvedKind },
        log,
      )
      if (candidates.length > 0) {
        return json({
          saved: false,
          reason: 'similar',
          title: filename,
          kind: KIND_LABEL[resolvedKind],
          message: '库里有疑似同一篇,这次没有写入。确认是另一篇后再传 confirmNew=true。',
          candidates: candidates.map(c => ({
            id: c.document.id,
            title: c.document.filename,
            url: reportUrl(c.document.id),
            reasons: similarReasons(c),
            titleScore: c.titleScore,
            contentScore: c.contentScore,
          })),
        })
      }
    }

    const doc = saveDocument({
      filename,
      kind: resolvedKind,
      size_bytes: Buffer.byteLength(markdown, 'utf8'),
      chunk_count: chunks.length,
    })
    const created = await publishVersion(doc.id, markdown, { note: trimmedNote, fallbackName: filename }, log)
    const saved = getDocument(doc.id)
    return json({
      saved: true,
      id: doc.id,
      title: saved?.filename ?? filename,
      kind: KIND_LABEL[saved?.kind ?? resolvedKind],
      version: created.version.version,
      note: created.version.note,
      url: reportUrl(doc.id),
    })
  })
}
