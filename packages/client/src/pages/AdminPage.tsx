import { useEffect, useState } from 'react'
import { Form, Input, Button, Alert } from 'antd'
import { useSiteModel } from '../hooks/useSiteModel'
import { useAuth } from '../hooks/useAuth'
import { BackLink } from '../components/BackLink'

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth()
  const { data, loading, saving, error, saved, save, reset } = useSiteModel()
  const [model, setModel] = useState('')
  // 输入框里的内容是否是还没保存/恢复的草稿,用来挡掉陈旧的「已保存/错误」提示
  const [dirty, setDirty] = useState(false)

  // 首次拿到服务端值时填充;之后管理员的输入不再被覆盖
  useEffect(() => {
    if (!data) return
    setModel(prev => prev || data.model || '')
  }, [data])

  if (authLoading || loading) {
    return <div className="mx-auto max-w-[720px] px-4 py-8 text-[#999]">加载中…</div>
  }

  // 后端三个路由都有 requireAdmin 兜底,这里只是不让非管理员白跑一趟。
  if (!user?.isAdmin) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-8">
        <Alert type="warning" showIcon title="需要管理员权限" />
      </div>
    )
  }

  const isChain = Boolean(data?.model?.includes(','))

  return (
    <div className="mx-auto max-w-[720px] px-4 py-5 md:px-6 md:py-8">
      <header className="mb-7 flex items-center justify-between gap-3">
        <h1 className="m-0 text-[24px] font-bold tracking-[2px]">站点默认模型</h1>
        <BackLink to="/" className="rounded-lg border border-[#e0e0e0] px-3 py-2 text-[14px] text-[#555] hover:bg-[#f3f3f0] hover:text-black">
          返回
        </BackLink>
      </header>

      {data?.configError && (
        <Alert type="error" showIcon className="mb-5" title={data.configError} />
      )}

      <p className="mb-5 text-[13px] leading-[1.7] text-[#777]">
        这里改的是所有走公共额度的提问用哪个模型,保存后下一次提问即生效,不用重启。
        自带 key 的用户不受影响,评估模块也不受影响。
        <br />
        服务商和站长 API key 仍然只来自 <code>.env</code>,这个页面改不了,也不会把 key 存进数据库。
      </p>

      <div className="mb-6 rounded-lg bg-[#f7f7f4] px-4 py-3 text-[14px]">
        当前生效:
        <strong className="mx-1.5">{data?.model ?? '(未配置)'}</strong>
        <span className="text-[13px] text-[#999]">
          {data?.source === 'db' ? '(已在此覆盖)' : '(来自 .env)'}
        </span>
      </div>

      {isChain && (
        <Alert
          type="info"
          showIcon
          className="mb-5"
          title={<>当前是 <code>.env</code> 里配的降级链,前一个模型报配额不足时会自动切到后一个。在这里保存单个模型名后,降级链就不再生效。</>}
        />
      )}

      <Form layout="vertical">
        <Form.Item label="模型" htmlFor="admin-model" className="mb-4">
          <Input
            id="admin-model"
            value={model}
            onChange={e => { setModel(e.target.value); setDirty(true) }}
            placeholder="模型名"
            list="site-model-suggestions"
          />
          <datalist id="site-model-suggestions">
            {data?.suggestedModels.map(m => <option key={m} value={m} />)}
          </datalist>
          <div className="mt-1.5 text-[12px] text-[#999]">
            下拉只是建议,可以直接填任意模型名。保存时会用站长的 key 实际调一次,不通过不会保存。
          </div>
        </Form.Item>
      </Form>

      {!dirty && error && <Alert type="error" showIcon className="mt-4" title={error} />}
      {!dirty && saved && !error && <Alert type="success" showIcon className="mt-4" title="已保存,下一次提问生效" />}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="primary"
          autoInsertSpace={false}
          disabled={saving || !model.trim()}
          onClick={() => void save(model.trim()).finally(() => setDirty(false))}
        >
          {saving ? '正在验证…' : '保存'}
        </Button>
        {data?.source === 'db' && (
          <Button
            disabled={saving}
            onClick={() => void reset()
              .then(ok => { if (ok) setModel(data.envModel ?? '') })
              .finally(() => setDirty(false))}
          >
            恢复为 .env 默认
          </Button>
        )}
      </div>
    </div>
  )
}
