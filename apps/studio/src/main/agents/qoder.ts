import type { PermissionMode } from '@shared/types'
import { splitArgs, type AgentAdapter, type TurnRequest } from './base'
import { claudeStreamAdapter } from './claude'

/**
 * Qoder CLI writes Claude Code's stream-json and answers its control protocol: with stream-json
 * input, tool approvals arrive as `can_use_tool` requests. It has no plan permission mode, so plan
 * runs without the tools that change files or run commands.
 */
const MODE: Record<PermissionMode, string[]> = {
  ask: ['--permission-mode', 'default'],
  acceptEdits: ['--permission-mode', 'accept_edits'],
  plan: ['--permission-mode', 'default', '--disallowed-tools', 'Bash,Edit,Write,NotebookEdit'],
  bypass: ['--dangerously-skip-permissions']
}

export function qoderArgs(req: TurnRequest): string[] {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', ...MODE[req.permissionMode]]
  if (req.model) args.push('--model', req.model)
  if (req.effort) args.push('--reasoning-effort', req.effort)
  if (req.resumeId) args.push('--resume', req.resumeId)
  else if (req.newSessionId) args.push('--session-id', req.newSessionId)
  if (req.systemAppend) args.push('--append-system-prompt', req.systemAppend)
  args.push(...splitArgs(req.settings.extraArgs))
  return args
}

function qoder(id: string, name: string, binary: string): AgentAdapter {
  return claudeStreamAdapter({
    id,
    name,
    binaryNames: [binary],
    args: qoderArgs,
    inspectArgs: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json'],
    models: [{ id: '', label: 'Default' }]
  })
}

export const qoderAdapter = qoder('qoder', 'Qoder CLI', 'qodercli')
export const qoderCnAdapter = qoder('qoder-cn', 'Qoder CLI (China)', 'qoderclicn')
