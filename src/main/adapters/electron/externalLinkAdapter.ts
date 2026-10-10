import type { ExternalLinkPort } from '../../contracts/ports'

export class ExternalLinkAdapter implements ExternalLinkPort {
  constructor(
    private openExternal = async (url: string): Promise<void> => {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    }
  ) {}
  open(url: string): Promise<void> {
    return this.openExternal(url)
  }
}
