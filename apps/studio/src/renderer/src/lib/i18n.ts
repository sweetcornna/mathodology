import { useStudio } from '../store'
import { commonEn, commonZh } from './i18n/common'
import { paneEn, paneZh } from './i18n/pane'
import { sessionEn, sessionZh } from './i18n/session'
import { settingsEn, settingsZh } from './i18n/settings'

const zh = {
  ...commonZh,
  ...sessionZh,
  ...paneZh,
  ...settingsZh
}

export type MessageKey = keyof typeof zh

const en: Record<MessageKey, string> = {
  ...commonEn,
  ...sessionEn,
  ...paneEn,
  ...settingsEn
}

const dicts = { 'zh-CN': zh, en }

export function translate(locale: keyof typeof dicts, key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[locale]?.[key] ?? zh[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export function useT(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  const locale = useStudio((s) => s.settings?.locale ?? 'zh-CN')
  return (key, vars) => translate(locale, key, vars)
}
