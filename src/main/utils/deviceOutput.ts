export function hasForwardPort(output: string, port: number): boolean {
  return new RegExp(`\\btcp:${port}(?!\\d)`).test(output)
}
export function parseTargets(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/empty|no devices|\[Fail\]/i.test(line))
}
export function parseBundles(output: string, variant: 'bm' | 'pm' | 'bm-user'): string[] {
  if (variant === 'pm')
    return output
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, '').trim())
      .filter(Boolean)
      .sort()
  return [
    ...new Set(
      output.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*BundleName\s*[:=]\s*(\S+)/)
        return match ? [match[1].trim()] : []
      })
    )
  ].sort()
}
export function parseForeground(output: string, variant: 'aa' | 'window'): string | null {
  if (variant === 'aa') {
    const match =
      output.trim().match(/bundleName\s*[:=]\s*(\S+)/i) || output.trim().match(/^([\w.]+)$/)
    return match?.[1] || null
  }
  const match = output.match(/mCurrentFocus\s*=\s*[^/]*\/(\S+)/)
  return match?.[1].replace(/[{}].*$/, '').trim() || null
}
