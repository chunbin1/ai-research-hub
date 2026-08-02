import { useCallback, useEffect, useState } from 'react'
import type { LLMConfigResponse, LLMSaveInput } from '../types'

export type TestResult = { ok: true } | { ok: false; reason: string }

async function readError(r: Response): Promise<string> {
  const body = await r.json().catch(() => ({}))
  return (body as { message?: string; error?: string }).message
    ?? (body as { error?: string }).error
    ?? '请求失败'
}

export function useLLMConfig() {
  const [data, setData] = useState<LLMConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/llm-config')
      if (!r.ok) { setError(await readError(r)); return }
      setData(await r.json() as LLMConfigResponse)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async (input: LLMSaveInput) => {
    setSaving(true); setError(null); setTestResult(null)
    try {
      const r = await fetch('/api/llm-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!r.ok) { setError(await readError(r)); return false }
      await refresh()
      return true
    } finally { setSaving(false) }
  }, [refresh])

  const remove = useCallback(async () => {
    setError(null); setTestResult(null)
    const r = await fetch('/api/llm-config', { method: 'DELETE' })
    if (!r.ok) { setError(await readError(r)); return false }
    await refresh()
    return true
  }, [refresh])

  const test = useCallback(async (input: Partial<LLMSaveInput>) => {
    setTesting(true); setError(null); setTestResult(null)
    try {
      const r = await fetch('/api/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      setTestResult(await r.json() as TestResult)
    } finally { setTesting(false) }
  }, [])

  return { data, loading, saving, testing, testResult, error, save, remove, test, refresh }
}
