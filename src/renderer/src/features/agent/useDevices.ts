import { useCallback, useEffect, useState } from 'react'

export function useDevices() {
  const [devices, setDevices] = useState<string[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.api.agent.execute('device.list', {})
      if (result.status !== 'succeeded') throw new Error(result.summary)
      const list = result.data as string[]
      setDevices(list)
      setDeviceId((prior) => (list.includes(prior) ? prior : list.length === 1 ? list[0] : ''))
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setDevices([])
      setDeviceId('')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) void refresh()
    })
    return () => {
      mounted = false
    }
  }, [refresh])
  return { devices, deviceId, setDeviceId, error, busy, refresh }
}
