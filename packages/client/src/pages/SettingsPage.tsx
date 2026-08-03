import { useEffect, useState } from 'react'
import { CheckCircleOutlined } from '@ant-design/icons'
import { Form, Select, Input, Switch, Button, Alert } from 'antd'
import { useLLMConfig } from '../hooks/useLLMConfig'
import { BackLink } from '../components/BackLink'

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
  // 换了服务商,或者(自定义 provider 时)换了端点,服务端现在要求必须重填
  // API key —— 省略 apiKey 只保留原密文,继续免填等于把老 key 发去新地方。
  const providerChanged = hasSavedKey && providerId !== data!.config!.providerId
  const endpointChanged = hasSavedKey && Boolean(preset?.custom) && baseURL.trim() !== (data!.config!.baseURL ?? '')
  const requiresKeyForChange = providerChanged || endpointChanged
  const canSubmit = Boolean(
    providerId && model.trim() && (apiKey.trim() || (hasSavedKey && !requiresKeyForChange)),
  )

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

  // 开关只切换 enabled,提交已保存的配置值,不带 apiKey(省略即保留原密文),
  // 也不动本地表单里可能还没保存的编辑内容
  async function onToggleEnabled(enabled: boolean) {
    if (!data?.config) return
    await save({
      providerId: data.config.providerId,
      baseURL: data.config.baseURL ?? undefined,
      model: data.config.model,
      enabled,
    })
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-5 md:px-6 md:py-8">
      <header className="mb-7 flex items-center justify-between gap-3">
        <h1 className="m-0 text-[24px] font-bold tracking-[2px]">模型设置</h1>
        <BackLink to="/" className="rounded-lg border border-[#e0e0e0] px-3 py-2 text-[14px] text-[#555] hover:bg-[#f3f3f0] hover:text-black">
          返回
        </BackLink>
      </header>

      {!data?.available && (
        <Alert
          type="warning"
          showIcon
          className="mb-5"
          message={<>服务端未配置 <code>LLM_KEY_SECRET</code>,自带模型功能不可用。请联系站点管理员。</>}
        />
      )}

      {data?.configError && (
        <Alert type="error" showIcon className="mb-5" message={data.configError} />
      )}

      <p className="mb-5 text-[13px] leading-[1.7] text-[#777]">
        填入自己的 API key 后,你的提问会走你自己的账号,不再受每人 {'​'}次数上限和全站总量限制。
        key 加密存储在服务器上,页面上只回显脱敏后的片段。
        <br />
        注意:检索研报用的向量化仍由站点承担,你的 key 只用于生成答案。
      </p>

      {data?.config && (
        <div className="mb-6 flex items-center gap-2.5 text-[14px]">
          <Switch
            checked={data.config.enabled}
            disabled={saving}
            onChange={checked => void onToggleEnabled(checked)}
          />
          使用我自己的模型
          <span className="text-[13px] text-[#999]">
            (关闭后回到公共额度,key 保留)
          </span>
        </div>
      )}

      <Form layout="vertical">
        <Form.Item label="服务商" className="mb-4">
          <Select
            value={providerId}
            onChange={value => { setProviderId(value); setModel('') }}
            options={data?.presets.map(p => ({ value: p.id, label: p.label }))}
            className="w-full"
          />
        </Form.Item>

        {preset?.custom && (
          <Form.Item label="baseURL" className="mb-4">
            <Input
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="https://your-endpoint.example.com/v1"
            />
            <div className="mt-1 text-[12px] text-[#999]">必须是 https,且不能指向内网地址。</div>
          </Form.Item>
        )}

        <Form.Item label="模型" className="mb-4">
          <Input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="模型名"
            list="model-suggestions"
          />
          <datalist id="model-suggestions">
            {preset?.suggestedModels.map(m => <option key={m} value={m} />)}
          </datalist>
          <div className="mt-1 text-[12px] text-[#999]">下拉只是建议,可以直接填任意模型名。</div>
        </Form.Item>

        <Form.Item label="API key" className="mb-4">
          <Input.Password
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={data?.config ? `已保存 ${data.config.keyHint},留空则不修改` : '填入你的 API key'}
            autoComplete="off"
          />
          {requiresKeyForChange && !apiKey.trim() && (
            <div className="mt-1 text-[12px] text-danger">更换服务商或端点后,必须重新填写 API key。</div>
          )}
        </Form.Item>
      </Form>

      {error && <Alert type="error" showIcon className="mt-4" message={error} />}

      {testResult && (
        <Alert
          className="mt-4"
          showIcon
          type={testResult.ok ? 'success' : 'error'}
          message={testResult.ok ? <>连接正常 <CheckCircleOutlined aria-hidden /></> : `连接失败:${testResult.reason}`}
        />
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          disabled={testing || !canSubmit}
          onClick={() => void test({
            providerId,
            baseURL: preset?.custom ? baseURL.trim() : undefined,
            model: model.trim(),
            apiKey: apiKey.trim() || undefined,
          })}
        >
          {testing ? '测试中…' : '测试连接'}
        </Button>
        {/* 「保存」正好两个汉字,antd 默认会在中间插入空格,导致可访问名不再是「保存」——关掉这个排版行为 */}
        <Button type="primary" autoInsertSpace={false} disabled={saving || !canSubmit} onClick={() => void onSave()}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {data?.config && (
          <Button danger onClick={() => { if (confirm('删除配置,回到公共额度?')) void remove() }}>
            删除配置
          </Button>
        )}
      </div>
    </div>
  )
}
