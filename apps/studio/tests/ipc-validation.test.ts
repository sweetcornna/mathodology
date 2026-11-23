import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { validStudioArgs } from '@shared/ipc-validation'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

it('rejects unlisted session fields and malformed queued-send arguments', () => {
  expect(validStudioArgs('sessions:update', ['s1', { model: undefined, title: 'renamed' }])).toBe(true)
  for (const patch of [{ id: 's2' }, { projectId: 'p2' }, { queue: [] }, { permissionMode: 'unknown' }, { archived: 'yes' }]) {
    expect(validStudioArgs('sessions:update', ['s1', patch])).toBe(false)
  }
  expect(validStudioArgs('sessions:sendQueued', ['s1', 'q1'])).toBe(true)
  expect(validStudioArgs('sessions:sendQueued', ['s1', '../q1'])).toBe(false)
  expect(validStudioArgs('sessions:sendQueued', ['s1'])).toBe(false)
})

it('validates nested settings and the complete permission response', () => {
  expect(validStudioArgs('settings:set', [{ agents: { codex: { binaryPath: '', defaultModel: '', extraArgs: '', env: '' } } }])).toBe(true)
  expect(validStudioArgs('settings:set', [{ connectors: [{ id: 'test', name: 'Test', enabled: true, url: 'file:///tmp/test' }] }])).toBe(false)
  expect(validStudioArgs('sessions:respondPermission', ['s1', 'req', true, undefined, { question: ['answer'] }])).toBe(true)
  expect(validStudioArgs('sessions:respondPermission', ['s1', 'req', true, undefined, { question: 'answer' }])).toBe(false)
})

it('only admits calls from the Studio window main frame at the renderer entry URL', async () => {
  const { registerStudioIpc } = await import('../src/main/ipc')
  const { ipcMain } = await import('electron')
  const entry = 'file:///studio/index.html'
  const mainFrame = { url: entry }
  const webContents = { mainFrame }
  const window = { webContents, isDestroyed: () => false }
  const handler = vi.fn()
  registerStudioIpc({ 'sessions:sendQueued': handler }, () => window as unknown as BrowserWindow, entry)
  const invoke = vi.mocked(ipcMain.handle).mock.calls.at(-1)![1] as (event: unknown, ...args: unknown[]) => void
  expect(() => invoke({ sender: {}, senderFrame: mainFrame }, 's1', 'q1')).toThrow('sender')
  expect(() => invoke({ sender: webContents, senderFrame: { url: entry } }, 's1', 'q1')).toThrow('sender')
  mainFrame.url = 'file:///studio/index.html.attacker.html'
  expect(() => invoke({ sender: webContents, senderFrame: mainFrame }, 's1', 'q1')).toThrow('sender')
  mainFrame.url = entry
  expect(() => invoke({ sender: webContents, senderFrame: mainFrame }, 's1', '../q1')).toThrow('arguments')
  invoke({ sender: webContents, senderFrame: mainFrame }, 's1', 'q1')
  expect(handler).toHaveBeenCalledExactlyOnceWith('s1', 'q1')
})
