import { useCallback, useEffect, useState } from 'react'
import type { SiteModelResponse } from '../types'

async function readError(r: Response): Promise<string> {
  const body = await r.json().catch(() => ({}))
  return (body as { message?: string; error?: string }).message
    ?? (body as { error?: string }).error
    ?? '请求失败'
}

export function useSiteModel() {
  const [data, setData] = useState<SiteModelResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/site-model')
      if (!r.ok) { setError(await readError(r)); return }
      setData(await r.json() as SiteModelResponse)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async (model: string) => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const r = await fetch('/api/site-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      if (!r.ok) { setError(await readError(r)); return false }
      setSaved(true)
      await refresh()
      return true
    } finally { setSaving(false) }
  }, [refresh])

  const reset = useCallback(async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const r = await fetch('/api/site-model', { method: 'DELETE' })
      if (!r.ok) { setError(await readError(r)); return false }
      await refresh()
      return true
    } finally { setSaving(false) }
  }, [refresh])

  return { data, loading, saving, error, saved, save, reset, refresh }
}
