import { constants, type Stats, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath, stat, unlink } from 'node:fs/promises'
import type { FileInfo, FileKind, FileSystemPort } from '../../contracts/ports'

function kind(info: Stats | Dirent): FileKind {
  return info.isSymbolicLink()
    ? 'symlink'
    : info.isFile()
      ? 'file'
      : info.isDirectory()
        ? 'directory'
        : 'other'
}
export class FileSystemAdapter implements FileSystemPort {
  async readDirectory(path: string): Promise<{ name: string; kind: FileKind }[]> {
    return (await readdir(path, { withFileTypes: true })).map((item) => ({
      name: item.name,
      kind: kind(item)
    }))
  }
  async info(path: string, followLinks: boolean): Promise<FileInfo> {
    const info = await (followLinks ? stat(path) : lstat(path))
    return {
      kind: kind(info),
      size: info.size,
      mtimeMs: info.mtimeMs,
      dev: info.dev,
      ino: info.ino
    }
  }
  realPath(path: string): Promise<string> {
    return realpath(path)
  }
  async makeDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }
  copyExclusive(source: string, destination: string): Promise<void> {
    return copyFile(source, destination, constants.COPYFILE_EXCL)
  }
  removeFile(path: string): Promise<void> {
    return unlink(path)
  }
}
