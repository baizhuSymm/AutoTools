import assert from 'node:assert/strict'
import { test } from 'node:test'
import { violations } from './helpers/architectureRules'

test('boundary rules reject actual static dynamic and runtime dependencies', () => {
  for (const source of [
    "import { readFile } from 'node:fs/promises'",
    "await import('electron-store')",
    "const fs = require('fs')",
    'fetch(url)',
    'globalThis.fetch(url)',
    "export { value } from '../adapters/value'",
    "import type { Storage } from '../adapters/value'",
    "import { createApplication } from '../bootstrap/createApplication'"
  ]) assert.notEqual(violations('src/main/services/bad.ts', source).length, 0, source)
  assert.notEqual(violations('src/main/adapters/bad.ts', "import type { ChatService } from '../services/agent/chatService'").length, 0)
  assert.notEqual(violations('src/main/ipc/bad.ts', "import { dialog, ipcMain } from 'electron'").length, 0)
  assert.notEqual(violations('src/main/ipc/bad.ts', "const { shell } = require('electron')").length, 0)
  assert.notEqual(violations('src/main/utils/bad.ts', "import fs from 'node:fs'").length, 0)
  assert.notEqual(violations('src/main/contracts/bad.ts', "import type { DeviceService } from '../services/deviceService'").length, 0)
})

test('boundary rules allow pure helpers contracts and ipcMain', () => {
  assert.deepEqual(violations('src/main/services/good.ts', "import { join } from 'node:path'"), [])
  assert.deepEqual(violations('src/main/services/good.ts', "import type { FileSystemPort } from '../contracts/ports'"), [])
  assert.deepEqual(violations('src/main/ipc/good.ts', "import { ipcMain, type IpcMainInvokeEvent } from 'electron'"), [])
  assert.deepEqual(violations('src/main/adapters/good.ts', "import { readFile } from 'node:fs/promises'"), [])
})
