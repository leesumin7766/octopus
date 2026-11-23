import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS } from '../../src/shared/command/types'
import { defaultSetting, parseSetting, readSetting } from '../../src/shared/settings/schema'
import { normalizeModelList, parseModelList } from '../../src/shared/validation/command'

const oai = { id: 'local', provider: 'openai-compatible', model: 'qwen', label: 'Local', baseUrl: 'http://localhost:1234/v1' }

describe('model list (command.models)', () => {
  it('defaults to Opus 5.5, Sonnet 5.5 and Haiku 5.5, and the default passes its own validation', () => {
    expect(DEFAULT_MODELS.map((m) => m.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
    expect(DEFAULT_MODELS[0].effort).toBe('medium')
    expect(parseModelList(DEFAULT_MODELS)).toEqual(DEFAULT_MODELS)
    expect(defaultSetting('command.models')).toEqual(DEFAULT_MODELS)
  })

  it('accepts an openai-compatible entry with an http(s) address', () => {
    expect(parseModelList([...DEFAULT_MODELS, oai])).toHaveLength(4)
  })

  it.each([
    ['empty list', []],
    ['not a list', 'x'],
    ['duplicate ids', [DEFAULT_MODELS[0], DEFAULT_MODELS[0]]],
    ['unknown provider', [{ ...oai, provider: 'other' }]],
    ['openai-compatible without baseUrl', [{ ...oai, baseUrl: undefined }]],
    ['non-http address', [{ ...oai, baseUrl: 'file:///etc/passwd' }]],
    ['baseUrl on anthropic', [{ ...DEFAULT_MODELS[0], baseUrl: 'https://x.test' }]],
    ['effort on openai-compatible', [{ ...oai, effort: 'low' }]],
    ['bad effort', [{ ...DEFAULT_MODELS[0], effort: 'max' }]],
    ['empty model name', [{ ...DEFAULT_MODELS[0], model: '' }]]
  ])('refuses %s', (_name, value) => {
    expect(parseModelList(value)).toBeNull()
    expect(parseSetting('command.models', value)).toBeNull()
  })

  it('a damaged saved list falls back to the defaults', () => {
    expect(normalizeModelList(42)).toEqual(DEFAULT_MODELS)
    expect(readSetting('command.models', [{ id: 1 }])).toEqual(DEFAULT_MODELS)
  })

  it('has no place to put an API key', () => {
    expect(parseModelList([{ ...DEFAULT_MODELS[0], apiKey: 'sk' }])?.[0]).not.toHaveProperty('apiKey')
  })

  it('command.model (the chosen model id) is a short string; empty means not chosen yet', () => {
    expect(defaultSetting('command.model')).toBe('')
    expect(parseSetting('command.model', 'anthropic-sonnet')).toBe('anthropic-sonnet')
    expect(parseSetting('command.model', '')).toBe('')
    expect(parseSetting('command.model', 5)).toBeNull()
    expect(parseSetting('command.model', 'x'.repeat(61))).toBeNull()
    expect(readSetting('command.model', { a: 1 })).toBe('')
  })
})
