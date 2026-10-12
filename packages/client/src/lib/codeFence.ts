/** 围栏代码块的开/闭行:最多缩进 3 格,3 个以上 ` 或 ~ */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/**
 * 逐行判断是不是在围栏代码块里,规则与服务端 markdownParser 的 scanHeadings 一致:
 * 闭围栏须同字符、不短于开围栏,且后面只能有空白(CommonMark)——
 * ``` 块里的 ~~~、```python 都只是代码,不会提前把块关掉。
 *
 * 返回的函数按顺序喂每一行,告诉你这行是不是围栏行、是否在代码块内(含围栏行本身)。
 * 代码块里的 `# 注释` 在阅读页不是标题(rehype-slug 不给它锚点),目录和对比都得跳过。
 */
export function fenceTracker(): (line: string) => { fence: boolean; inCode: boolean } {
  let open: string | null = null
  return (line) => {
    const m = FENCE_RE.exec(line)
    if (!m) return { fence: false, inCode: open !== null }
    if (open === null) open = m[1]
    else if (m[1][0] === open[0] && m[1].length >= open.length && !line.slice(m[0].length).trim()) open = null
    else return { fence: false, inCode: true } // 块里的另一种围栏:普通代码行
    return { fence: true, inCode: true }
  }
}
