import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLLMConfig } from '../hooks/useLLMConfig'

const inputCls = 'w-full rounded-lg border border-[#ddd] px-3 py-[9px] text-[14px]'
const btnCls = 'cursor-pointer rounded-lg border border-[#ddd] bg-white px-4 py-[9px] text-[14px] hover:bg-[#f3f3f0] disabled:cursor-not-allowed disabled:opacity-50'
const primaryCls = 'cursor-pointer rounded-lg bg-[#1a1a1a] px-4 py-[9px] text-[14px] text-white disabled:cursor-not-allowed disabled:opacity-50'

export default function SettingsPage() {
  const { data, loading, saving, testing, testResult, error, save, remove, test } = useLLMConfig()

  const [providerId, setProviderId] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')

  // 首次拿到服务端配置时填充表单;之后用户的输入不再被覆盖
  useEffect(() => {
    if (!data) return
    setProviderId(prev => prev || data.config?.providerId || data.presets[0]?.id || '')
    setBaseURL(prev => prev || data.config?.baseURL || '')
    setModel(prev => prev || data.config?.model || '')
  }, [data])

  if (loading) return <div className="mx-auto max-w-[720px] px-4 py-8 text-[#999]">加载中…</div>

  const preset = data?.presets.find(p => p.id === providerId) ?? null
  const hasSavedKey = Boolean(data?.config)
  const canSubmit = Boolean(providerId && model.trim() && (apiKey.trim() || hasSavedKey))

  async function onSave(enabled?: boolean) {
    const ok = await save({
      providerId,
      baseURL: preset?.custom ? baseURL.trim() : undefined,
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
      enabled,
    })
    if (ok) setApiKey('')
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-5 md:px-6 md:py-8">
      <header className="mb-7 flex items-center justify-between gap-3">
        <h1 className="m-0 text-[24px] font-bold tracking-[2px]">模型设置</h1>
        <Link to="/" className="rounded-lg border border-[#e0e0e0] px-3 py-2 text-[14px] text-[#555] hover:bg-[#f3f3f0] hover:text-black">
          ← 返回
        </Link>
      </header>

      {!data?.available && (
        <div className="mb-5 rounded-lg border border-[#e7d9a8] bg-gold-wash p-4 text-[14px] text-gold-ink">
          服务端未配置 <code>LLM_KEY_SECRET</code>,自带模型功能不可用。请联系站点管理员。
        </div>
      )}

      {data?.configError && (
        <div className="mb-5 rounded-lg border border-[#f0c8c8] bg-[#fdf4f4] p-4 text-[14px] text-danger">
          {data.configError}
        </div>
      )}

      <p className="mb-5 text-[13px] leading-[1.7] text-[#777]">
        填入自己的 API key 后,你的提问会走你自己的账号,不再受每人 {'​'}次数上限和全站总量限制。
        key 加密存储在服务器上,页面上只回显脱敏后的片段。
        <br />
        注意:检索研报用的向量化仍由站点承担,你的 key 只用于生成答案。
      </p>

      {data?.config && (
        <label className="mb-6 flex items-center gap-2.5 text-[14px]">
          <input
            type="checkbox"
            checked={data.config.enabled}
            onChange={e => void onSave(e.target.checked)}
          />
          使用我自己的模型
          <span className="text-[13px] text-[#999]">
            (关闭后回到公共额度,key 保留)
          </span>
        </label>
      )}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[14px]">
          服务商
          <select className={inputCls} value={providerId} onChange={e => { setProviderId(e.target.value); setModel('') }}>
            {data?.presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        {preset?.custom && (
          <label className="flex flex-col gap-1.5 text-[14px]">
            baseURL
            <input
              className={inputCls}
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="https://your-endpoint.example.com/v1"
            />
            <span className="text-[12px] text-[#999]">必须是 https,且不能指向内网地址。</span>
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-[14px]">
          模型
          <input
            className={inputCls}
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="模型名"
            list="model-suggestions"
          />
          <datalist id="model-suggestions">
            {preset?.suggestedModels.map(m => <option key={m} value={m} />)}
          </datalist>
          <span className="text-[12px] text-[#999]">下拉只是建议,可以直接填任意模型名。</span>
        </label>

        <label className="flex flex-col gap-1.5 text-[14px]">
          API key
          <input
            className={inputCls}
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={data?.config ? `已保存 ${data.config.keyHint},留空则不修改` : '填入你的 API key'}
            autoComplete="off"
          />
        </label>
      </div>

      {error && <div className="mt-4 text-[14px] text-danger">{error}</div>}

      {testResult && (
        <div className={`mt-4 text-[14px] ${testResult.ok ? 'text-gold-ink' : 'text-danger'}`}>
          {testResult.ok ? '连接正常 ✓' : `连接失败:${testResult.reason}`}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className={btnCls}
          disabled={testing || !canSubmit}
          onClick={() => void test({
            providerId,
            baseURL: preset?.custom ? baseURL.trim() : undefined,
            model: model.trim(),
            apiKey: apiKey.trim() || undefined,
          })}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className={primaryCls} disabled={saving || !canSubmit} onClick={() => void onSave()}>
          {saving ? '保存中…' : '保存'}
        </button>
        {data?.config && (
          <button
            className="cursor-pointer rounded-lg border border-[#f0c8c8] bg-white px-4 py-[9px] text-[14px] text-danger hover:bg-[#fdf4f4]"
            onClick={() => { if (confirm('删除配置,回到公共额度?')) void remove() }}
          >
            删除配置
          </button>
        )}
      </div>
    </div>
  )
}
