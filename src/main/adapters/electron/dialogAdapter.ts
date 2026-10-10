import type { FolderDialogPort } from '../../contracts/ports'

export class DialogAdapter implements FolderDialogPort {
  constructor(
    private show = async (): Promise<{ canceled: boolean; filePaths: string[] }> => {
      const { dialog } = await import('electron')
      return dialog.showOpenDialog({ properties: ['openDirectory'] })
    }
  ) {}
  async selectFolder(): Promise<string | null> {
    const result = await this.show()
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
}
