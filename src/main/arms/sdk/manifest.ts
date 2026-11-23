import { ARM_AUTH_KINDS, ARM_CAPABILITIES, type ArmManifest } from '../../../shared/arms/types'

export const ARM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

export type ManifestResult = { ok: true; manifest: ArmManifest } | { ok: false; problems: string[] }

const isString = (v: unknown): v is string => typeof v === 'string'

/** 매니페스트 검사. 틀린 곳을 모두 모아 돌려준다(값 원문은 넣지 않는다). */
export function validateManifest(raw: unknown): ManifestResult {
  const problems: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['manifest must be an object'] }
  const m = raw as Record<string, unknown>

  if (!isString(m.id) || !ARM_ID_PATTERN.test(m.id)) problems.push('id must be lowercase letters, digits and hyphens (up to 40)')
  if (!isString(m.name) || m.name.trim() === '' || m.name.length > 40) problems.push('name must be a non-empty string up to 40 characters')
  if (!isString(m.version) || m.version.trim() === '' || m.version.length > 40) problems.push('version must be a non-empty string')
  if (!isString(m.auth) || !(ARM_AUTH_KINDS as readonly string[]).includes(m.auth)) problems.push(`auth must be one of ${ARM_AUTH_KINDS.join(', ')}`)

  if (!Array.isArray(m.capabilities) || !m.capabilities.every((c) => isString(c) && (ARM_CAPABILITIES as readonly string[]).includes(c))) {
    problems.push('capabilities must be a list of known capabilities')
  } else if (new Set(m.capabilities).size !== m.capabilities.length) problems.push('capabilities must not repeat')

  if (m.scopes !== undefined && (!Array.isArray(m.scopes) || !m.scopes.every((s) => isString(s) && s !== ''))) problems.push('scopes must be a list of strings')
  if (m.description !== undefined && (!isString(m.description) || m.description.length > 300)) problems.push('description must be a string up to 300 characters')
  if (m.syncIntervalMinutes !== undefined && (typeof m.syncIntervalMinutes !== 'number' || !Number.isFinite(m.syncIntervalMinutes) || m.syncIntervalMinutes < 1 || m.syncIntervalMinutes > 1440)) {
    problems.push('syncIntervalMinutes must be a number from 1 to 1440')
  }
  if (isString(m.auth) && m.auth === 'oauth' && (!Array.isArray(m.scopes) || m.scopes.length === 0)) problems.push('an oauth arm must list the scopes it needs')

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, manifest: m as unknown as ArmManifest }
}
