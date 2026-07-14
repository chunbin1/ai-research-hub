// packages/server/src/routes/eval.ts
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from './auth.js'
import { getAllDocuments, getDocument } from '../services/documentStore.js'
import { createRun, hasRunningRun, getLatestRunByDoc, getResults, aggregateStats } from '../services/evalStore.js'
import { runEval } from '../services/evalRunner.js'

export const evalRoutes: FastifyPluginAsync = async (app) => {
  // 列表 + 顶部统计
  app.get('/eval', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const reports = getAllDocuments().map(d => {
      const run = getLatestRunByDoc(d.id)
      return {
        doc_id: d.id,
        filename: d.filename,
        status: run?.status ?? 'none',
        question_count: run?.question_count ?? 0,
        avg_recall: run?.avg_recall ?? null,
        avg_precision: run?.avg_precision ?? null,
        avg_faithfulness: run?.avg_faithfulness ?? null,
        avg_relevancy: run?.avg_relevancy ?? null,
        finished_at: run?.finished_at ?? null,
      }
    })
    return { stats: aggregateStats(), reports }
  })

  // 触发异步评估
  app.post<{ Body: { docId?: string } }>('/eval/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const docId = req.body?.docId
    if (!docId) return reply.status(400).send({ error: 'docId is required' })
    if (!getDocument(docId)) return reply.status(404).send({ error: 'document not found' })
    if (hasRunningRun(docId)) return reply.status(409).send({ error: 'already_running' })
    const runId = createRun(docId)
    // fire-and-forget:runEval 内部自捕获,失败会 failRun
    void runEval(docId, runId)
    return { runId, status: 'running' }
  })

  // 某篇明细
  app.get<{ Params: { docId: string } }>('/eval/:docId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const run = getLatestRunByDoc(req.params.docId)
    if (!run) return reply.status(404).send({ error: 'no_run' })
    return { run, results: getResults(run.id) }
  })
}
