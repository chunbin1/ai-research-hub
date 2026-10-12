import { describe, expect, it } from 'vitest'
import { askPrompt, mcpUrl, setupGuides } from './askElsewhere'

describe('askElsewhere', () => {
  it('MCP 地址挂在 /api/mcp,去掉 origin 尾斜杠', () => {
    expect(mcpUrl('https://arh.example/')).toBe('https://arh.example/api/mcp')
  })

  it('文案带标题、id 和工具调用顺序;看最新版时不提版本', () => {
    const p = askPrompt({ docId: 'doc_1', title: '锂电产业链', version: 2, isLatest: true })
    expect(p).toContain('《锂电产业链》(id: doc_1)')
    expect(p).toContain('get_report_outline')
    expect(p).not.toContain('v2')
    expect(p.endsWith('我的问题:')).toBe(true)
  })

  it('看历史版本时文案点名版本,模型才会读对那一版', () => {
    const p = askPrompt({ docId: 'doc_1', title: '锂电', version: 1, isLatest: false })
    expect(p).toContain('看 v1 这个历史版本')
  })

  it('各家配置都用同一个地址', () => {
    const url = 'https://arh.example/api/mcp'
    expect(setupGuides(url).every(g => g.code?.includes(url))).toBe(true)
  })
})
