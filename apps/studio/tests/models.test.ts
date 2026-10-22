import { describe, expect, it } from 'vitest'
import { claudeModels } from '../src/main/agents/claude'
import { codexModels } from '../src/main/agents/codex'
import { geminiModelsFromSource } from '../src/main/agents/gemini'
import { brandOf, modelBrand } from '../src/shared/brands'

describe('model discovery', () => {
  it('maps Claude Code initialize models, keeping default as the CLI default', () => {
    const models = claudeModels([
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', supportedEffortLevels: ['low', 'high'] },
      { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
      { displayName: 'no value' }
    ])
    expect(models).toEqual([
      { id: '', label: 'Default (recommended)', description: 'Opus 5.5', model: 'claude-opus-5-5', efforts: ['low', 'high'] },
      { id: 'haiku', label: 'Haiku 5.5', description: undefined, model: 'claude-haiku-5-5', efforts: undefined }
    ])
  })

  it('maps Codex model/list with groups, efforts and the default', () => {
    const models = codexModels([
      { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', description: 'Workhorse', hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low' },
      { id: 'auto/claude-opus-5-5', model: 'auto/claude-opus-5-5', displayName: 'Claude Opus 5.5 · OpenASI · routing group', description: '', hidden: false, isDefault: false, supportedReasoningEfforts: [] },
      { id: 'secret', model: 'secret', displayName: 'Hidden', hidden: true }
    ])
    expect(models.map((m) => [m.id, m.label, m.group])).toEqual([
      ['', 'Default', undefined],
      ['gpt-6.1-sol', 'GPT-6.1-Sol', undefined],
      ['auto/claude-opus-5-5', 'Claude Opus 5.5', 'OpenASI · routing group']
    ])
    expect(models[0]).toMatchObject({ model: 'gpt-6.1-sol' })
    expect(models[1]).toMatchObject({ efforts: ['low', 'high'], defaultEffort: 'low' })
  })

  it('also reads the `codex debug models` catalogue', () => {
    const models = codexModels([
      { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }], default_reasoning_level: 'medium' },
      { slug: 'codex-auto-review', display_name: 'Review', visibility: 'hide' }
    ])
    expect(models.map((m) => m.id)).toEqual(['', 'gpt-6-luna'])
    expect(models[1]).toMatchObject({ efforts: ['medium'], defaultEffort: 'medium' })
  })

  it('reads Gemini CLI model constants from its bundle', () => {
    const source = [
      'var DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";',
      'var DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";',
      'var PREVIEW_GEMINI_FLASH_LITE_MODEL = "none";',
      'var PREVIEW_GEMINI_MODEL = "gemini-3-pro-preview";',
      'var PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL = "gemini-3.1-pro-preview-customtools";',
      'var LATEST_GEMINI_FLASH_MODEL = "gemini-3.8-flash";',
      'var PREVIEW_GEMINI_MODEL_AUTO = "auto-gemini-3";'
    ].join('\n')
    expect(geminiModelsFromSource(source).map((m) => [m.id, m.label])).toEqual([
      ['auto-gemini-3', 'Auto (Gemini 3)'],
      ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
      ['gemini-3-pro-preview', 'Gemini 3 Pro Preview'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro']
    ])
  })
})

describe('provider icons', () => {
  it('picks the provider from the model name, not the agent', () => {
    expect(brandOf('claude-opus-5-5')).toBe('claude')
    expect(brandOf('auto/claude-sonnet-5')).toBe('claude')
    expect(brandOf('gpt-6.1-sol')).toBe('openai')
    expect(brandOf('o4-mini')).toBe('openai')
    expect(brandOf('antigravity/gemini-3-flash')).toBe('gemini')
    expect(brandOf('deepseek-v4')).toBe('deepseek')
    expect(brandOf('qwen3-coder')).toBe('qwen')
    expect(brandOf('glm-5')).toBe('zhipu')
    expect(brandOf('something-else')).toBeNull()
    expect(modelBrand({ id: '', label: 'Default' }, 'codex')).toBe('openai')
    expect(modelBrand({ id: 'antigravity/gpt-oss-120b-medium', label: 'GPT-OSS 120B' }, 'codex')).toBe('openai')
    expect(modelBrand({ id: 'auto/claude-opus-5-5', label: 'Claude Opus 5.5' }, 'codex')).toBe('claude')
  })
})
