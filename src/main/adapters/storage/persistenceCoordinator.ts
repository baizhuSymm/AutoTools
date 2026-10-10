export interface PersistenceTarget {
  commit(): Promise<void>
  flush(): Promise<void>
}

export class PersistenceCoordinator {
  private timer?: ReturnType<typeof setTimeout>
  private failure?: unknown
  constructor(
    private target: PersistenceTarget,
    private reportError: (error: unknown) => void
  ) {}

  schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.commit().catch(() => {})
    }, 1000)
    this.timer.unref?.()
  }
  async commit(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    try {
      await this.target.commit()
      this.failure = undefined
    } catch (error) {
      this.failure = error
      this.reportError(error)
      throw error
    }
  }
  async flush(): Promise<void> {
    if (this.timer) await this.commit()
    await this.target.flush()
    if (this.failure) throw this.failure
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
