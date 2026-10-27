// 大佬持仓。公开读。WHALES=off 时整组 404，与信号开关同一档。
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { isWhalesEnabled } from '../services/whales/enabled.js'
import { getWhaleDetail, listWhaleSummaries } from '../services/whales/view.js'

export const whaleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => {
    if (!isWhalesEnabled()) return reply.status(404).send({ error: 'whales_disabled' })
  })

  app.get('/whales', describeRoute(
    ['whales'],
    '大佬持仓列表',
    '公开读。返回六家种子机构。没有 13F 的机构 dataStatus 为 empty，latest 为 null。WHALES=off 时 404 { error: "whales_disabled" }。与实盘持仓 /api/holdings 不是同一份数据。',
  ), async () => listWhaleSummaries())

  app.get<{ Params: { slug: string } }>('/whales/:slug', describeRoute(
    ['whales'],
    '一家机构的 13F 持仓',
    '公开读。positions 是最新报告期，closed 是相对上一期清掉的仓。没有上一期时 change 为 null。未知 slug 返回 404 { error: "not_found" }。',
  ), async (request, reply) => {
    const detail = getWhaleDetail(request.params.slug)
    if (!detail) return reply.status(404).send({ error: 'not_found' })
    return detail
  })
}
