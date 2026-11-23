import { AGENT_IDS, PERMISSION_MODES, type StudioCalls } from './ipc'

type Check = (value: unknown) => boolean
const text: Check = (v) => typeof v === 'string'
const path: Check = (v) => typeof v === 'string' && v.length > 0 && !v.includes('\0')
const bool: Check = (v) => typeof v === 'boolean'
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const version: Check = (v) => number(v) && Number.isSafeInteger(v) && (v as number) > 0
const id: Check = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)
const optional = (check: Check): Check => (v) => v === undefined || check(v)
const oneOf = (values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v)
const list = (check: Check): Check => (v) => Array.isArray(v) && v.every(check)
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const dictionary = (key: Check, item: Check): Check =>
  (v) => record(v) && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && key(k) && item(x))
const shape = (fields: Record<string, Check>, partial = false): Check =>
  (v) => record(v) && Object.keys(v).every((k) => Object.hasOwn(fields, k)) &&
    Object.entries(fields).every(([k, check]) => {
      const own = Object.hasOwn(v, k)
      return partial && !own || check(own ? v[k] : undefined)
    })
const agent = oneOf(AGENT_IDS)
const permissionMode = oneOf(PERMISSION_MODES)
const contest = oneOf(['MCM', 'ICM', 'CUMCM', 'Huawei', 'MathorCup', 'Stats', 'APMCM', 'Huashu', 'Other'])
const url: Check = (v) => {
  if (typeof v !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}
const connector = shape({
  id, name: text, enabled: bool, command: optional(path), args: optional(list(text)),
  env: optional(dictionary(text, text)), url: optional(url), builtin: optional(bool)
})
const kind = oneOf(['published', 'preprint', 'dataset', 'web'])
const paper = shape({
  title: text, url: text, snippet: text, byline: optional(text), date: optional(text), doi: optional(text),
  arxiv: optional(text), citedBy: optional(number), kind: optional(kind), retracted: optional(bool),
  alts: optional(list(shape({ url: text, kind, doi: optional(text), arxiv: optional(text) })))
})
const settings = shape({
  onboarded: bool, locale: oneOf(['zh-CN', 'en']), theme: oneOf(['system', 'light', 'dark']),
  fontScale: (v) => number(v) && (v as number) > 0, workspaceRoot: path, defaultAgent: agent,
  defaultPermissionMode: permissionMode, sendWithEnter: bool, installHumanizer: bool, connectors: list(connector),
  agents: dictionary(agent, shape({ binaryPath: text, defaultModel: text, extraArgs: text, env: text }))
}, true)
const sessionPatch = shape({
  title: text, pinned: bool, archived: bool, model: optional(text), effort: optional(text), permissionMode, agent
}, true)

export const STUDIO_CALL_ARGUMENTS = {
  'app:info': [],
  'settings:get': [],
  'settings:set': [settings],
  'agents:detect': [optional(bool)],
  'projects:list': [],
  'projects:create': [shape({ name: text, parentDir: optional(path), existingPath: optional(path), contest, installKit: bool })],
  'projects:installKit': [id],
  'projects:remove': [id],
  'sessions:list': [],
  'sessions:create': [shape({ projectId: id, agent, model: optional(text), effort: optional(text), title: optional(text), permissionMode })],
  'sessions:update': [id, sessionPatch],
  'sessions:delete': [id],
  'sessions:events': [id],
  'sessions:send': [shape({ sessionId: id, text, attachments: list(shape({ name: text, path })) })],
  'sessions:interrupt': [id],
  'sessions:respondPermission': [id, text, bool, optional(bool), optional(dictionary(text, list(text)))],
  'sessions:dequeue': [id, id],
  'sessions:sendQueued': [id, id],
  'files:list': [id, optional(text)],
  'files:preview': [id, path],
  'artifacts:list': [id],
  'artifacts:read': [id, id, version],
  'artifacts:restore': [id, id, version],
  'connectors:check': [connector],
  'lit:search': [text, optional(text)],
  'lit:cite': [id, paper],
  'lit:graph': [paper],
  'lit:published': [paper],
  'refs:check': [id, optional(path)],
  'refs:setDoi': [id, path, text, text],
  'checks:run': [id, optional(shape({ compile: optional(bool) }))],
  'reviews:list': [id],
  'reviews:start': [id],
  'reviews:cancel': [id],
  'reviews:setStatus': [id, id, id, oneOf(['open', 'resolved', 'dismissed'])],
  'shell:openPath': [path],
  'shell:openExternal': [(v: unknown) => url(v) || typeof v === 'string' && /^mailto:[^\r\n]+$/i.test(v)],
  'dialog:pickFolder': [optional(text)],
  'dialog:pickFiles': []
} satisfies Record<keyof StudioCalls, Check[]>

export function validStudioArgs(channel: keyof StudioCalls, args: unknown[]): boolean {
  const checks: Check[] = STUDIO_CALL_ARGUMENTS[channel]
  return args.length <= checks.length && checks.every((check, i) => check(args[i]))
}
