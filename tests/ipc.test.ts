import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerAgentIpc } from '../src/main/ipc/agentIpc'
import type { ApplicationServices } from '../src/main/bootstrap/createApplication'
import { AgentChannels } from '../src/shared/agent'

test('IPC validates authority and input before service delegation and unregisters', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let calls = 0
  const services = {
    sessions: {
      create: () => {
        calls++
        return 'new'
      }
    },
    chat: {
      send: () => {
        calls++
      }
    }
  } as unknown as ApplicationServices
  const platform = {
    ipcMain: {
      handle: (name: string, callback: (...args: unknown[]) => unknown) =>
        handlers.set(name, callback),
      removeHandler: (name: string) => handlers.delete(name)
    } as unknown as Pick<IpcMain, 'handle' | 'removeHandler'>,
    selectFolder: async () => null
  }
  const trusted = { allowed: true } as unknown as IpcMainInvokeEvent
  const dispose = registerAgentIpc(services, (event) => event === trusted, platform)
  assert.throws(() => handlers.get(AgentChannels.Create)!({}))
  assert.throws(() => handlers.get(AgentChannels.Send)!(trusted, 'invalid-id', 'hello'))
  assert.equal(calls, 0)
  assert.equal(handlers.get(AgentChannels.Create)!(trusted), 'new')
  assert.equal(calls, 1)
  dispose()
  assert.equal(handlers.size, 0)
})
