import { isAbsolute, resolve } from 'node:path'

export function absolute(path: string): string {
  if (!isAbsolute(path)) throw new Error('请选择绝对目录路径')
  return resolve(path)
}
export function equalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
