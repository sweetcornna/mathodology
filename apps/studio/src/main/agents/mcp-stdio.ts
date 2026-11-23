import { spawn, type ChildProcess } from 'node:child_process'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { launch } from './launch'
import { supervise } from './supervisor'

export class McpStdio implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private child?: ChildProcess
  private stop?: () => void
  private exited?: Promise<void>
  private readonly buffer = new ReadBuffer()

  constructor(private readonly command: string, private readonly args: string[], private readonly env: NodeJS.ProcessEnv) {}

  start(): Promise<void> {
    const { file, args, verbatim } = launch(this.command, this.args)
    const child = spawn(file, args, {
      env: this.env, stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32',
      windowsHide: true, windowsVerbatimArguments: verbatim
    })
    const supervisor = supervise(child)
    this.child = child
    this.stop = supervisor.finish
    this.exited = new Promise((resolve) => child.once('close', () => {
      this.child = undefined
      this.buffer.clear()
      this.onclose?.()
      resolve()
    }))
    child.stdin.on('error', (error) => this.onerror?.(error))
    child.stdout.on('error', (error) => this.onerror?.(error))
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.buffer.append(chunk)
        for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error as Error)
        supervisor.finish()
      }
    })
    return new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.on('error', (error) => {
        this.onerror?.(error)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    this.stop?.()
    await this.exited
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const input = this.child?.stdin
    if (!input?.writable) throw new Error('MCP transport is closed')
    await new Promise<void>((resolve, reject) => {
      input.write(serializeMessage(message), (error) => error ? reject(error) : resolve())
    })
  }
}
