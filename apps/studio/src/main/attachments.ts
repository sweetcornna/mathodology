import { constants, copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { Attachment } from '@shared/types'
import { safeJoin } from './files'

function uniqueTarget(dir: string, requested: string): string {
  // Only the file name counts: "../x" or "/abs/x" still lands in the attachments folder.
  const base = basename(requested)
  const name = base && base !== '.' && base !== '..' ? base : 'attachment'
  let target = join(dir, name)
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let i = 2; existsSync(target); i++) target = join(dir, `${stem}-${i}${ext}`)
  return target
}

export function stageAttachments(root: string, attachments: Attachment[]): { paths: string[]; discard(): void } {
  const paths: string[] = []
  const written: string[] = []
  const discard = (): void => {
    for (const file of written) {
      try {
        rmSync(file, { force: true })
      } catch (error) {
        console.warn('could not remove an unadmitted attachment', error)
      }
    }
  }
  if (!attachments.length) return { paths, discard }
  const dir = safeJoin(root, 'attachments')
  mkdirSync(dir, { recursive: true })
  try {
    for (const { path, name } of attachments) {
      if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error('Attachment must be a local file')
      const target = uniqueTarget(dir, name)
      copyFileSync(path, target, constants.COPYFILE_EXCL)
      written.push(target)
      paths.push(`attachments/${basename(target)}`)
    }
    return { paths, discard }
  } catch (error) {
    discard()
    throw error
  }
}
