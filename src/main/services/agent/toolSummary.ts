import type { ToolResult } from '../../../shared/agent'
export function summarizeResult(result: ToolResult): string {
  const body = JSON.stringify(result)
  if (Buffer.byteLength(body) <= 8192) return body
  const data: Record<string, unknown> = {}
  if (result.data && typeof result.data === 'object') {
    const original = result.data as Record<string, unknown>
    for (const key of [
      'id',
      'taskId',
      'deviceId',
      'bundleName',
      'status',
      'total',
      'count',
      'offset',
      'nextOffset'
    ]) {
      const value = original[key]
      if (typeof value === 'string') data[key] = value.slice(0, 128)
      else if (typeof value === 'number' || value === null) data[key] = value
    }
    if (Array.isArray(original.files)) {
      data.files = original.files.slice(0, 10).map((file: Record<string, unknown>) => ({
        id: String(file.id).slice(0, 128),
        name: String(file.name).slice(0, 200),
        size: typeof file.size === 'number' ? file.size : undefined
      }))
      data.count = original.files.length
      if (typeof original.offset === 'number')
        data.nextOffset = original.offset + Math.min(10, original.files.length)
      data.more = '使用 video.results 查询扫描记录的分页清单'
    }
  }
  const summarized = {
    status: result.status,
    summary: result.summary.slice(0, 512),
    truncated: true,
    data
  }
  let encoded = JSON.stringify(summarized)
  const files = data.files as unknown[] | undefined
  while (Buffer.byteLength(encoded) > 8192 && files && files.length > 1) {
    files.pop()
    if (typeof data.offset === 'number') data.nextOffset = data.offset + files.length
    encoded = JSON.stringify(summarized)
  }
  return encoded
}
