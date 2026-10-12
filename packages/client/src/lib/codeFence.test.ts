import { test, expect } from 'vitest'
import { fenceTracker } from './codeFence'

const run = (md: string) => {
  const track = fenceTracker()
  return md.split('\n').map(l => track(l).inCode)
}

test('围栏行和块内行都算代码,块外不算', () => {
  expect(run('正文\n```python\n# 注释\n```\n正文')).toEqual([false, true, true, true, false])
})

test('``` 块里的 ~~~ 不会提前关块', () => {
  expect(run('```\n~~~\n# 还在代码里\n```\n# 标题')).toEqual([true, true, true, true, false])
})

test('闭围栏不能比开围栏短', () => {
  expect(run('````\n```\n# 还在\n````\n外面')).toEqual([true, true, true, true, false])
})

test('缩进 4 格的 ``` 不是围栏', () => {
  expect(run('    ```\n# 标题')).toEqual([false, false])
})

test('带信息字符串的 ```python 在代码块里只是内容,不会关块', () => {
  expect(run('```\n```python\n# 注释\n```\n# 标题')).toEqual([true, true, true, true, false])
})
