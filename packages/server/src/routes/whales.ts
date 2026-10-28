// 名家持仓。公开读，管理员可增删。WHALES=off 时整组 404，与信号开关同一档。
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { requireAdmin } from './auth.js'
import { isWhalesEnabled } from '../services/whales/enabled.js'
import { normalizeCik, normalizeSlug, slugFromNames } from '../services/whales/identity.js'
import { syncOneWhale, type OneSync } from '../services/whales/sync.js'
import { deleteInstitution, getInstitution, insertInstitution, markSync, WhaleWriteError } from '../services/whales/store.js'
import { getWhaleDetail, listWhaleSummaries } from '../services/whales/view.js'

export interface WhaleRouteOptions {
  syncOne?: (slug: string) => Promise<OneSync>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const whaleRoutes: FastifyPluginAsync<WhaleRouteOptions> = async (app, opts) => {
  const syncOne = opts.syncOne ?? ((slug: string) => syncOneWhale(slug))

  app.addHook('onRequest', async (_request, reply) => {
    if (!isWhalesEnabled()) return reply.status(404).send({ error: 'whales_disabled' })
  })

  app.get('/whales', describeRoute(
    ['whales'],
    '名家持仓列表',
    '公开读。返回种子机构和后来添加的机构。没有 13F 的机构 dataStatus 为 empty，latest 为 null。WHALES=off 时 404 { error: "whales_disabled" }。',
  ), async () => listWhaleSummaries())

  app.post('/whales', describeRoute(
    ['whales'],
    '添加机构',
    '仅管理员。写入成功后立即返回，SEC 申报在后台拉取（sync 为 pending）。没有 13F 仍保留，列表为暂无数据；拉取失败由列表上的最近一次拉取失败承接。slug 或 CIK 与现有行冲突时 409。',
  ), async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const body = (request.body ?? {}) as {
      cik?: unknown
      manager?: unknown
      nameZh?: unknown
      nameEn?: unknown
      slug?: unknown
    }
    const manager = text(body.manager)
    const nameZh = text(body.nameZh)
    const nameEn = text(body.nameEn)
    if (!manager) return reply.status(400).send({ error: 'invalid_input', message: '请填写管理人' })
    if (!nameZh) return reply.status(400).send({ error: 'invalid_input', message: '请填写中文名' })
    if (manager.length > 40 || nameZh.length > 80 || nameEn.length > 160) {
      return reply.status(400).send({ error: 'invalid_input', message: '名称过长' })
    }
    const cik = typeof body.cik === 'string' ? normalizeCik(body.cik) : null
    if (!cik) return reply.status(400).send({ error: 'invalid_input', message: 'CIK 须为不超过 10 位的数字' })
    const rawSlug = text(body.slug)
    const slug = rawSlug ? normalizeSlug(rawSlug) : slugFromNames(nameEn, nameZh)
    if (!slug) {
      const message = rawSlug
        ? '短名只能用小写字母、数字和连字符'
        : '请填写网址短名，这个名字生成不了可用链接'
      return reply.status(400).send({ error: rawSlug ? 'invalid_input' : 'slug_required', message })
    }
    try {
      insertInstitution({ slug, nameZh, nameEn, manager, cik })
    } catch (err) {
      if (err instanceof WhaleWriteError) {
        return reply.status(409).send({ error: err.code, message: err.message })
      }
      throw err
    }
    void syncOne(slug).catch(err => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[whales] 后台拉取 ${slug} 失败: ${message}`)
      markSync(slug, new Date().toISOString(), message.slice(0, 500))
    })
    const institution = listWhaleSummaries().institutions.find(row => row.slug === slug) ?? null
    return reply.status(201).send({ institution, sync: 'pending' })
  })

  app.get<{ Params: { slug: string }; Querystring: { period?: string } }>('/whales/:slug', describeRoute(
    ['whales'],
    '一家机构的 13F 持仓',
    '公开读。默认 positions 是最新报告期。query period=YYYY-MM-DD 时改为该期，并和库里更早的相邻一期对比。periods 列出已入库的报告期，新的在前。closed 是相对上一期清掉的仓。没有上一期时 change 为 null。未知 slug 返回 404 { error: "not_found" }。period 格式不对返回 400 { error: "invalid_input" }。机构在、这一期不在返回 404 { error: "period_not_found" }。',
  ), async (request, reply) => {
    const period = request.query.period
    if (period !== undefined && period !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      return reply.status(400).send({ error: 'invalid_input', message: '报告期须为 YYYY-MM-DD' })
    }
    const selected = period ? period : undefined
    const detail = getWhaleDetail(request.params.slug, selected)
    if (!detail) {
      if (selected && getInstitution(request.params.slug)) {
        return reply.status(404).send({ error: 'period_not_found' })
      }
      return reply.status(404).send({ error: 'not_found' })
    }
    return detail
  })

  app.delete<{ Params: { slug: string } }>('/whales/:slug', describeRoute(
    ['whales'],
    '删除机构',
    '仅管理员。硬删这一家，并清掉它的申报、持仓和同步记录。代码里的种子会在下次进程启动时写回。',
  ), async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    if (!deleteInstitution(request.params.slug)) return reply.status(404).send({ error: 'not_found' })
    return { ok: true }
  })
}
