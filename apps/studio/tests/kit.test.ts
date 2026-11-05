import { describe, expect, it } from 'vitest'
import { mergeHooks } from '../src/main/kit'

describe('mixed hook groups', () => {
  it('replaces only Workbench commands, preserving group metadata and other hook types', () => {
    const custom = { type: 'command', command: 'run-custom-check', timeout: 45 }
    const prompt = { type: 'prompt', prompt: 'Review the edit' }
    const settings = {
      model: 'mine',
      hooks: { PreToolUse: [{ matcher: 'Write|Edit', description: 'my checks', hooks: [
        custom, { type: 'command', command: 'python mathodology-workbench/scripts/mtd.py hook pre-edit' }, prompt
      ] }] }
    }
    const spec = { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '{mtd} hook pre-edit' }] }] }
    const result = mergeHooks(settings, spec)
    expect(result).toMatchObject({ model: 'mine', hooks: { PreToolUse: [
      { matcher: 'Write|Edit', description: 'my checks', hooks: [custom, prompt] },
      { matcher: 'Edit', hooks: [{ type: 'command' }] }
    ] } })
    expect(mergeHooks(result, spec)).toEqual(result)
    expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(3)
    expect(mergeHooks(result, {})).toEqual({ model: 'mine', hooks: { PreToolUse: [
      { matcher: 'Write|Edit', description: 'my checks', hooks: [custom, prompt] }
    ] } })
  })
})
