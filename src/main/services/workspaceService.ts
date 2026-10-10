import type { FolderDialogPort } from '../contracts/ports'

export class WorkspaceService {
  constructor(private dialog: FolderDialogPort) {}
  selectFolder(): Promise<string | null> {
    return this.dialog.selectFolder()
  }
}
