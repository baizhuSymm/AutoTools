import { FileSystemAdapter } from '../../src/main/adapters/filesystem/fileSystemAdapter'
import { fakeHdc } from './hdcFixture'

export function applicationPlatform() {
  const browser = {
    open: async (): Promise<never> => {
      throw new Error('unexpected browser operation')
    }
  }
  return {
    files: new FileSystemAdapter(),
    hdc: fakeHdc(),
    chrome: browser,
    external: browser,
    dialog: { selectFolder: async () => null }
  }
}
