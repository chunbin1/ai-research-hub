import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

const SAVED = {
  available: true,
  presets: [
    { id: 'zhipu',    label: '智谱 GLM', kind: 'openai', suggestedModels: ['glm-4-flash'], custom: false },
    { id: 'deepseek', label: 'DeepSeek',  kind: 'openai', suggestedModels: ['deepseek-chat'], custom: false },
    { id: 'custom',   label: '自定义',    kind: 'openai', suggestedModels: [], custom: true },
  ],
  config: {
    providerId: 'zhipu', baseURL: null, model: 'glm-4-flash',
    keyHint: 'sk-a……4f2a', enabled: true, updatedAt: 'now',
  },
  effective: { model: 'glm-4-flash', source: 'user', providerId: 'zhipu' },
  configError: null,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SAVED }) as Response))
}

afterEach(() => { vi.unstubAllGlobals() })

function renderPage() {
  return render(<MemoryRouter><SettingsPage /></MemoryRouter>)
}

// antd Select:不渲染原生 <select>,需要点开下拉再点选项。
// 注:brief 里给的 `.ant-select-selector` 是旧版 antd 的类名,antd 6 实测渲染的是
// `.ant-select`(内部结构变成 `.ant-select-content` + 只读的 combobox input),
// 以浏览器 / 测试里实际跑出来的 DOM 为准。
const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  SAVED.presets.map(p => [p.id, p.label]),
)

async function selectProvider(container: HTMLElement, value: string) {
  const selector = container.querySelector('.ant-select') as HTMLElement
  fireEvent.mouseDown(selector)
  const opt = await screen.findByTitle(PROVIDER_LABEL[value] ?? value)
  fireEvent.click(opt)
}

// antd Input.Password:仍是原生 <input>,但 type 会随「显示密码」切换,改用 class 定位
async function typeApiKey(container: HTMLElement, value: string) {
  const input = container.querySelector('.ant-input-password input') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

// 服务商下拉的 onChange 里会把 model 清空(与本任务要测的安全守卫无关的既有行为,
// 见 packages/client/src/pages/SettingsPage.tsx `setModel('')`)。
// 不补填 model,canSubmit 会因为 model.trim() 为空而恒为 false,
// 测不出「保存被禁用」到底是不是安全守卫在起作用。所以切换服务商后统一补填 model。
async function typeModel(container: HTMLElement, value: string) {
  const input = container.querySelector('input[placeholder="模型名"]') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

test('已保存 zhipu 配置时,不改动任何字段则可以保存', async () => {
  stubFetch()
  renderPage()
  const save = await screen.findByRole('button', { name: /保存/ })
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
})

test('换服务商但不填 key 时,保存被禁用', async () => {
  stubFetch()
  const { container } = renderPage()
  await screen.findByRole('button', { name: /保存/ })

  // 把 provider 从 zhipu 换成 deepseek,不填 key(但补填 model —— 见 typeModel 注释,
  // 否则 canSubmit 会因为 model 为空而恒为 false,测不出禁用是不是守卫在起作用)
  await selectProvider(container, 'deepseek')
  await typeModel(container, 'deepseek-chat')

  const save = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement
  await waitFor(() => expect(save.disabled).toBe(true))
})

test('换服务商并填了 key 后,保存恢复可用', async () => {
  stubFetch()
  const { container } = renderPage()
  await screen.findByRole('button', { name: /保存/ })

  await selectProvider(container, 'deepseek')
  await typeModel(container, 'deepseek-chat')
  await typeApiKey(container, 'sk-new-key-1234567890')

  const save = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement
  await waitFor(() => expect(save.disabled).toBe(false))
})

// 前三条测试都只走 providerChanged 分支;endpointChanged 分支(custom 预设下,
// 不换服务商、只改 baseURL,尤其是 baseURL.trim() !== (data.config.baseURL ?? '')
// 这一步 —— 已保存的 null 要能跟空字符串比相等)此前完全没有测试覆盖到。
// 注意:已保存配置的 providerId 必须本来就是 'custom',否则切换服务商本身会
// 先触发 providerChanged,盖住了要测的 endpointChanged 分支。
const SAVED_CUSTOM = {
  ...SAVED,
  config: {
    providerId: 'custom', baseURL: null, model: 'custom-model',
    keyHint: 'sk-c……9e1b', enabled: true, updatedAt: 'now',
  },
}

function stubFetchCustom() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SAVED_CUSTOM }) as Response))
}

test('已保存 custom 端点配置时,只改 baseURL 不填 key,保存被禁用', async () => {
  stubFetchCustom()
  const { container } = renderPage()
  const save = await screen.findByRole('button', { name: /保存/ })
  // 未改动时可以保存,先确认没有其他分支意外把它挡住
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))

  const baseURLInput = container.querySelector('#settings-base-url') as HTMLInputElement
  fireEvent.change(baseURLInput, { target: { value: 'https://my-endpoint.example.com/v1' } })

  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true))
})
