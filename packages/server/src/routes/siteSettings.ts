// packages/server/src/routes/siteSettings.ts
//
// 站点默认模型(管理员)。只改模型名 —— provider、baseURL、站长 API key 仍
// 只来自 .env,不进数据库,所以这条路径不依赖 LLM_KEY_SECRET。
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from './auth.js'
import {
  getSetting,
  setSetting,
  deleteSetting,
  DEFAULT_MODEL_KEY,
} from '../services/siteSettingsStore.js'
import { getPreset } from '../services/providerPresets.js'
import { serverLLMConfig, probeLLMConfig, describeLLMError } from '../llm.js'

export interface SiteSettingsOptions {
  /**
   * 保存前的可用性探测。默认打真实上游;测试传入假实现,让
   * 「探测失败不写库」「探测成功才写库」两条路径不依赖网络。
   */
  probe?: typeof probeLLMConfig
}

interface SaveBody { model?: unknown }

export const siteSettingsRoutes: FastifyPluginAsync<SiteSettingsOptions> = async (app, opts) => {
  const probe = opts.probe ?? probeLLMConfig

  app.get('/site-model', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const override = getSetting(DEFAULT_MODEL_KEY)

    // 站长一把 key 都没配时 serverLLMConfig() 会抛。这里捕获成 configError
    // 照常渲染 —— 管理员正是来这个页面处理问题的。与 /llm-config 的做法一致。
    let providerId: string | null = null
    let envModel: string | null = null
    let suggestedModels: string[] = []
    let configError: string | null = null
    try {
      providerId = serverLLMConfig().providerId
      envModel =
        (providerId === 'anthropic' ? process.env.ANTHROPIC_MODEL : process.env.ZHIPU_MODEL) || null
      suggestedModels = getPreset(providerId)?.suggestedModels ?? []
    } catch (err) {
      configError = err instanceof Error ? err.message : '站点默认模型不可用'
    }

    return {
      providerId,
      // 生效值的原始字符串,不做拆分:.env 里配了降级链时它会形如
      // `glm-4.7,glm-4-flash`,界面原样显示。
      model: override ?? envModel,
      source: override ? ('db' as const) : ('env' as const),
      envModel,
      suggestedModels,
      configError,
    }
  })

  app.put<{ Body: SaveBody }>('/site-model', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const raw = (request.body ?? {}).model
    if (typeof raw !== 'string') {
      return reply.status(400).send({ error: 'invalid_input', message: 'model 必须是字符串' })
    }
    const model = raw.trim()
    if (!model) {
      return reply.status(400).send({ error: 'invalid_input', message: '模型名不能为空' })
    }

    let base
    try {
      base = serverLLMConfig()
    } catch (err) {
      return reply.status(400).send({
        error: 'no_provider',
        message: err instanceof Error ? err.message : '站点未配置任何 API key',
      })
    }

    // 模型名填错会让全站走公共额度的提问全部失败,而管理员要到下一次有人
    // 提问时才发现 —— 所以保存前先用站长 key 探一次,失败就不落库。
    let result
    try {
      result = await probe({ ...base, models: [model] })
    } catch (err) {
      return reply.status(400).send({ error: 'probe_failed', message: describeLLMError(err) })
    }
    if (!result.ok) {
      return reply.status(400).send({ error: 'probe_failed', message: result.reason })
    }

    setSetting(DEFAULT_MODEL_KEY, model)
    return { ok: true }
  })

  app.delete('/site-model', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    deleteSetting(DEFAULT_MODEL_KEY)
    return { ok: true }
  })
}
