// packages/server/src/llm.ts
//
// 生成侧的唯一入口。这里刻意不读 process.env —— 用哪把 key、哪个模型、哪个
// 端点,全由调用方传进来的 LLMConfig 决定(见 services/llmConfigStore.ts)。
// 站长默认配置由 serverLLMConfig() 从环境变量拼出来,和用户自带配置走同一条路。
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMConfig, StreamChatOptions } from './types.js'
import { logLlmRequest } from './llmLog.js'
import { markDegraded } from './services/tracing.js'

const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/'

/** 站长默认配置。没配任何 key 时抛错 —— 调用时才抛,不在模块加载时炸掉整个进程。 */
export function serverLLMConfig(): LLMConfig {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase()
  const provider =
    explicit === 'anthropic' || explicit === 'zhipu' ? explicit
    : process.env.ANTHROPIC_API_KEY ? 'anthropic'
    : process.env.ZHIPU_API_KEY ? 'zhipu'
    : null

  if (!provider) {
    throw new Error('No LLM provider configured. Set ANTHROPIC_API_KEY or ZHIPU_API_KEY in .env')
  }

  if (provider === 'anthropic') {
    return {
      kind: 'anthropic',
      providerId: 'anthropic',
      models: [process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'],
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      source: 'server',
    }
  }

  return {
    kind: 'openai',
    providerId: 'zhipu',
    baseURL: ZHIPU_BASE_URL,
    models: (process.env.ZHIPU_MODEL ?? 'glm-4-flash').split(',').map(s => s.trim()).filter(Boolean),
    apiKey: process.env.ZHIPU_API_KEY ?? '',
    source: 'server',
  }
}

export function isQuotaError(err: unknown): boolean {
  const e = err as {
    status?: number
    code?: number | string
    message?: string
    error?: { code?: number | string; message?: string }
  }
  const code = e?.status ?? e?.code ?? e?.error?.code
  const msg = (e?.message ?? e?.error?.message ?? '').toLowerCase()
  return (
    code === 429 ||
    msg.includes('quota') ||
    msg.includes('insufficient') ||
    msg.includes('billing')
  )
}

/** 把上游错误翻译成能直接给用户看的一句话。绝不包含 key 本身。 */
export function describeLLMError(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } }
  const raw = e?.error?.message ?? e?.message ?? '未知错误'
  switch (true) {
    case e?.status === 401 || e?.status === 403: return `API key 无效或没有权限:${raw}`
    case e?.status === 404: return `模型名不存在,或 baseURL 指向的端点不对:${raw}`
    case e?.status === 429: return `触发频控或额度不足:${raw}`
    case typeof e?.status === 'number' && e.status >= 500: return `上游服务异常(${e.status}):${raw}`
    default: return raw
  }
}

/**
 * 依次尝试 models,只在「配额类错误 + 还有下一个」时切换。
 *
 * 注意:切换发生在 run() 抛错时,而抛错可能发生在已经 yield 出部分文本之后 ——
 * 这时下一个模型的输出会接在前半段后面。这是改造前就有的行为,原样保留。
 */
export async function* withModelFallback(
  models: string[],
  run: (model: string) => AsyncGenerator<string>,
): AsyncGenerator<string> {
  for (let i = 0; i < models.length; i++) {
    try {
      yield* run(models[i])
      return
    } catch (err) {
      const hasNext = i < models.length - 1
      if (isQuotaError(err) && hasNext) {
        console.warn(`[llm] model "${models[i]}" quota exhausted, switching to "${models[i + 1]}"`)
        markDegraded('llm_model_fallback', { from: models[i], to: models[i + 1] })
        continue
      }
      throw err
    }
  }
}

async function* streamAnthropic(
  opts: StreamChatOptions,
  model: string,
): AsyncGenerator<string> {
  const { messages, system, maxTokens = 2048, signal, onReasoning, config } = opts
  const client = new Anthropic({ apiKey: config.apiKey })

  const stream = await client.messages.stream(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: messages.map(({ role, content }) => ({ role, content })),
    },
    { signal },
  )

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') {
      if (chunk.delta.type === 'text_delta') {
        yield chunk.delta.text
      } else if (chunk.delta.type === 'thinking_delta' && onReasoning) {
        onReasoning(chunk.delta.thinking)
      }
    }
  }
}

type OpenAIRole = 'system' | 'user' | 'assistant'

async function* streamOpenAICompatible(
  opts: StreamChatOptions,
  model: string,
): AsyncGenerator<string> {
  const { messages, system, maxTokens = 2048, signal, onReasoning, config } = opts
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })

  const chat: { role: OpenAIRole; content: string }[] = system
    ? [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role as OpenAIRole, content: m.content }))]
    : messages.map(m => ({ role: m.role as OpenAIRole, content: m.content }))

  const stream = await client.chat.completions.create(
    { model, max_tokens: maxTokens, stream: true, messages: chat },
    { signal },
  )

  for await (const chunk of stream) {
    // reasoning_content 是智谱在 OpenAI 兼容格式上的扩展字段,SDK 类型里没有,需断言。
    const delta = chunk.choices[0]?.delta as { content?: string; reasoning_content?: string } | undefined
    if (delta?.reasoning_content && onReasoning) onReasoning(delta.reasoning_content)
    if (delta?.content) yield delta.content
  }
}

export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<string> {
  const { config } = opts
  // streamChat 是 async generator,下面这行日志要到调用方首次迭代(next())时才运行。
  // 但调用方(routes/chat.ts)会立即用 for await 驱动,所以实际时机没变。
  logLlmRequest(opts.tag ?? 'chat', {
    model: config.models[0],
    system: opts.system,
    messages: opts.messages,
  })

  const run = config.kind === 'anthropic'
    ? (model: string) => streamAnthropic(opts, model)
    : (model: string) => streamOpenAICompatible(opts, model)

  yield* withModelFallback(config.models, run)
}

/**
 * 用最小代价验证一份配置是否可用:发一条 max_tokens=1 的请求,拿到第一个
 * 事件就断开。给设置页的「测试连接」用。
 */
export async function probeLLMConfig(
  config: LLMConfig,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const stream = streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      config,
      maxTokens: 1,
      tag: 'llm-config/test',
    })
    for await (const _chunk of stream) break
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: describeLLMError(err) }
  }
}
