import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class JsonStore {
  warning?: string
  backupPath?: string
  private tail: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {}

  async load<T>(fallback: T, validate?: (input: unknown) => T): Promise<T> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      return validate ? validate(parsed) : (parsed as T)
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return fallback
      this.backupPath = `${this.path}.corrupt-${Date.now()}`
      await copyFile(this.path, this.backupPath).catch(() => {})
      this.warning = `本地记录无法读取，已保留备份：${this.backupPath}`
      return fallback
    }
  }

  save(value: unknown): Promise<void> {
    const body = JSON.stringify(value)
    const save = this.tail
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = `${this.path}.${randomUUID()}.tmp`
        await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.path)
      })
    this.tail = save
    return save
  }
  flush(): Promise<void> {
    return this.tail
  }
}
