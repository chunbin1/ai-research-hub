/**
 * 「去 Claude / Codex / Grok 里问」:站点的 MCP 地址 + 一段可直接粘贴的提问文案。
 *
 * 文案里写死工具名和调用顺序 —— 模型拿到 id 后先看目录、再按章节读,
 * 不会一上来把几万字整篇读进上下文。
 */

/** MCP 连接器名。文案和各家配置命令里用同一个,用户才对得上 */
export const CONNECTOR_NAME = 'research-hub'

export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/mcp`
}

export function askPrompt(opts: { docId: string; title: string; version?: number; isLatest: boolean }): string {
  const ver = !opts.isLatest && opts.version !== undefined ? `,看 v${opts.version} 这个历史版本` : ''
  return [
    `请用「${CONNECTOR_NAME}」连接器读研报《${opts.title}》(id: ${opts.docId}${ver}):`,
    '先用 get_report_outline 看目录,再用 read_report 只读和问题相关的章节。',
    '回答时注明引用的章节,并附上工具返回的原文链接。',
    '',
    '我的问题:',
  ].join('\n')
}

export function setupGuides(url: string): Array<{ client: string; how: string; code?: string }> {
  return [
    { client: 'Claude 网页 / 桌面 / 手机', how: '设置 → 连接器 → 添加自定义连接器,名称填 research-hub,地址粘贴:', code: url },
    { client: 'Claude Code', how: '终端里运行:', code: `claude mcp add --transport http ${CONNECTOR_NAME} ${url}` },
    { client: 'Codex', how: '加到 ~/.codex/config.toml:', code: `[mcp_servers.${CONNECTOR_NAME}]\nurl = "${url}"` },
    { client: 'Grok', how: '在支持远程 MCP 的入口(如 xAI API 的 MCP 工具)填同一个地址。', code: url },
  ]
}
