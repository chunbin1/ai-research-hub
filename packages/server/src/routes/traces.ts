// packages/server/src/routes/traces.ts
import type { FastifyPluginAsync } from 'fastify'
import { listTraces, getTrace, traceStats } from '../services/traceStore.js'
import { requireAdmin } from './auth.js'

export const traceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { status?: string; route?: string; limit?: string } }>(
    '/traces', async (req, reply) => {
      if (!requireAdmin(req, reply)) return
      const { status, route, limit } = req.query
      return { traces: listTraces({ status, route, limit: limit ? Number(limit) : undefined }) }
    })

  // 注册在 /traces/:id 之前,避免 "stats" 被当作 :id。
  app.get<{ Querystring: { route?: string } }>('/traces/stats', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    return traceStats({ route: req.query.route })
  })

  app.get<{ Params: { id: string } }>('/traces/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const found = getTrace(req.params.id)
    if (!found) return reply.code(404).send({ error: 'trace not found' })
    return found
  })
}
