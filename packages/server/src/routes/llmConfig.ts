// packages/server/src/routes/llmConfig.ts
//
// 用户自带模型的配置接口。全部要求登录。
// 明文 key 只在 PUT / POST test 的请求体里出现,不回显、不落日志。
import type { FastifyPluginAsync } from 'fastify'
import { requireUser } from './auth.js'
import {
  getConfig,
  upsertConfig,
  deleteConfig,
  resolveLLMConfig,
  getStoredApiKey,
  LLMConfigInputError,
  LLMConfigDecryptError,
  type ConfigInput,
} from '../services/llmConfigStore.js'
import { PRESETS, getPreset, assertPublicBaseURL, BaseURLRejectedError } from '../services/providerPresets.js'
import { isSecretBoxAvailable } from '../services/secretBox.js'
import { probeLLMConfig, describeLLMError } from '../llm.js'
import type { LLMConfig } from '../types.js'

interface SaveBody {
  providerId?: string
  baseURL?: string | null
  model?: string
  apiKey?: string
  enabled?: boolean
}

const UNAVAILABLE = {
  error: 'secret_box_unavailable',
  message: '服务端未配置 LLM_KEY_SECRET,自带模型功能不可用',
}

export const llmConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get('/llm-config', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const row = getConfig(user.id)
    const publicPresets = PRESETS.map(p => ({
      id: p.id, label: p.label, kind: p.kind,
      suggestedModels: p.suggestedModels, custom: p.custom === true,
    }))

    // effective:下一次问答实际会用的模型。解密失败时不让整个页面挂掉 ——
    // 用户正是来这个页面修配置的。
    let effective: { model: string; source: 'user' | 'server'; providerId: string } | null = null
    let configError: string | null = null
    try {
      const cfg = resolveLLMConfig(user)
      effective = { model: cfg.models[0], source: cfg.source, providerId: cfg.providerId }
    } catch (err) {
      configError = err instanceof LLMConfigDecryptError ? err.message : '模型配置不可用'
    }

    return {
      available: isSecretBoxAvailable(),
      presets: publicPresets,
      config: row && {
        providerId: row.provider,
        baseURL: row.base_url,
        model: row.model,
        keyHint: row.key_hint,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at,
      },
      effective,
      configError,
    }
  })

  app.put<{ Body: SaveBody }>('/llm-config', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!isSecretBoxAvailable()) return reply.status(503).send(UNAVAILABLE)

    const body = request.body ?? {}
    if (!body.providerId) return reply.status(400).send({ error: 'invalid_input', message: '缺少 providerId' })
    if (!body.model) return reply.status(400).send({ error: 'invalid_input', message: '缺少 model' })

    const preset = getPreset(body.providerId)
    if (!preset) return reply.status(400).send({ error: 'invalid_input', message: `未知的 provider:${body.providerId}` })

    if (preset.custom) {
      const raw = body.baseURL?.trim()
      if (!raw) return reply.status(400).send({ error: 'invalid_base_url', message: '自定义 provider 必须填写 baseURL' })
      try {
        await assertPublicBaseURL(raw)
      } catch (err) {
        if (err instanceof BaseURLRejectedError) {
          return reply.status(400).send({ error: 'invalid_base_url', message: err.message })
        }
        throw err
      }
    }

    try {
      upsertConfig(user.id, body as ConfigInput)
    } catch (err) {
      if (err instanceof LLMConfigInputError) {
        return reply.status(400).send({ error: 'invalid_input', message: err.message })
      }
      throw err
    }
    return { ok: true }
  })

  app.delete('/llm-config', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    deleteConfig(user.id)
    return { ok: true }
  })

  app.post<{ Body: SaveBody }>('/llm-config/test', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const body = request.body ?? {}
    let config: LLMConfig

    if (body.apiKey) {
      // 用请求体里这份还没保存的配置试 —— 用户点「测试连接」时正在编辑
      const preset = body.providerId ? getPreset(body.providerId) : null
      if (!preset) return reply.status(400).send({ ok: false, reason: '未知的 provider' })
      if (!body.model?.trim()) return reply.status(400).send({ ok: false, reason: '缺少模型名' })

      let baseURL = preset.baseURL ?? undefined
      if (preset.custom) {
        const raw = body.baseURL?.trim()
        if (!raw) return reply.status(400).send({ ok: false, reason: '自定义 provider 必须填写 baseURL' })
        try {
          await assertPublicBaseURL(raw)
        } catch (err) {
          if (err instanceof BaseURLRejectedError) return reply.status(400).send({ ok: false, reason: err.message })
          throw err
        }
        baseURL = raw
      }

      config = {
        kind: preset.kind, providerId: preset.id, baseURL,
        models: [body.model.trim()], apiKey: body.apiKey, source: 'user',
      }
    } else {
      // 没给 key —— key 用库里存的那份,但 providerId/model 以请求体
      // (表单当前值)为准:用户点「测试连接」时最常见的操作是改了模型名还没保存,
      // 测的必须是屏幕上正在显示的值,而不是上一次保存的值。
      // 也不走 resolveLLMConfig 的 enabled 门槛 —— 配置只是被开关关掉时,
      // 测试连接应该照样可用,让用户能在重新打开开关前先验证。
      //
      // baseURL 是例外,不能一并放开:如果请求体能把 providerId 改成 custom
      // 并塞一个任意 baseURL,库里存的 key(哪怕是智谱这类预置 provider 的)
      // 就会被发到攻击者指定的公网主机 —— 明文 key 本来只在服务端内存里
      // 短暂存在,从不回显给前端,这一下等于给 XSS 开了个取 key 的后门。
      // 所以自定义端点只在库里存的本来就是 custom provider 时才认请求体的
      // baseURL;否则必须显式带一把新 key,走上面 if (body.apiKey) 分支 ——
      // 那是调用方自己的 key,爱指哪儿指哪儿。
      let stored
      try {
        stored = getStoredApiKey(user)
      } catch (err) {
        if (err instanceof LLMConfigDecryptError) return reply.status(400).send({ ok: false, reason: err.message })
        throw err
      }
      if (!stored) {
        return reply.status(400).send({ ok: false, reason: '尚未配置自己的模型' })
      }
      const { row, apiKey } = stored

      const providerId = body.providerId?.trim() || row.provider
      const preset = getPreset(providerId)
      if (!preset) return reply.status(400).send({ ok: false, reason: '未知的 provider' })

      if (preset.custom && getPreset(row.provider)?.custom !== true) {
        return reply.status(400).send({
          ok: false,
          reason: '切换到自定义 provider 前需要先填写并保存该端点对应的 API key',
        })
      }

      const model = body.model?.trim() || row.model

      let baseURL = preset.baseURL ?? undefined
      if (preset.custom) {
        // 走到这里已确保 row.provider === 'custom',请求体里的 baseURL
        // 只是在改「用户自己这份 custom 配置」指向的端点,不是换成别人的。
        const raw = body.baseURL?.trim() || row.base_url || undefined
        if (!raw) return reply.status(400).send({ ok: false, reason: '自定义 provider 必须填写 baseURL' })
        try {
          await assertPublicBaseURL(raw)
        } catch (err) {
          if (err instanceof BaseURLRejectedError) return reply.status(400).send({ ok: false, reason: err.message })
          throw err
        }
        baseURL = raw
      }

      config = { kind: preset.kind, providerId: preset.id, baseURL, models: [model], apiKey, source: 'user' }
    }

    try {
      return await probeLLMConfig(config)
    } catch (err) {
      return { ok: false as const, reason: describeLLMError(err) }
    }
  })
}
