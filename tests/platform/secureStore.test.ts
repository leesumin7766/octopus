import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSecureStore,
  SecureStoreError,
  type SecretCipher
} from '../../src/main/platform/secureStore'

// 테스트용 가짜 암호화: 바이트를 XOR 한다. 평문이 그대로 남지 않으면 충분하다.
function xor(data: Uint8Array): Buffer {
  return Buffer.from(Uint8Array.from(data, (b) => b ^ 0x5a))
}

function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plain) => xor(Buffer.from(plain, 'utf8')),
    decrypt: (data) => xor(data).toString('utf8')
  }
}

describe('createSecureStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'octopus-secure-'))
    filePath = join(dir, 'secrets.bin')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a value', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('arm:google-calendar', 'refreshToken', 'rt-secret-123')

    expect(store.get('arm:google-calendar', 'refreshToken')).toBe('rt-secret-123')
    // 새 인스턴스(앱 재시작)에서도 읽힌다.
    expect(createSecureStore(filePath, fakeCipher()).get('arm:google-calendar', 'refreshToken')).toBe(
      'rt-secret-123'
    )
  })

  it('returns undefined for missing values', () => {
    const store = createSecureStore(filePath, fakeCipher())

    expect(store.get('arm:none', 'k')).toBeUndefined()
    store.set('arm:a', 'k', 'v')
    expect(store.get('arm:a', 'other')).toBeUndefined()
  })

  it('does not leave the plaintext secret in the file', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('arm:google-calendar', 'refreshToken', 'rt-secret-123')

    const text = readFileSync(filePath).toString('latin1')
    expect(text).not.toContain('rt-secret-123')
    expect(text).not.toContain('refreshToken')
  })

  it('keeps namespaces separate and deleteNamespace only clears that namespace', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('arm:a', 'token', 'secret-a')
    store.set('arm:b', 'token', 'secret-b')
    store.set('arm:a', 'other', 'secret-a2')

    expect(store.get('arm:a', 'token')).toBe('secret-a')
    expect(store.get('arm:b', 'token')).toBe('secret-b')

    store.deleteNamespace('arm:a')

    expect(store.get('arm:a', 'token')).toBeUndefined()
    expect(store.get('arm:a', 'other')).toBeUndefined()
    expect(store.get('arm:b', 'token')).toBe('secret-b')
  })

  it('delete removes a single key only', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('arm:a', 'one', '1')
    store.set('arm:a', 'two', '2')

    store.delete('arm:a', 'one')

    expect(store.get('arm:a', 'one')).toBeUndefined()
    expect(store.get('arm:a', 'two')).toBe('2')
  })

  it('handles names that look like object prototype keys', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('__proto__', 'constructor', 'v')

    expect(store.get('__proto__', 'constructor')).toBe('v')
    expect(createSecureStore(filePath, fakeCipher()).get('__proto__', 'constructor')).toBe('v')
  })

  it('leaves no temp file after writing', () => {
    const store = createSecureStore(filePath, fakeCipher())
    store.set('arm:a', 'k', 'v')
    store.set('arm:a', 'k', 'v2')
    store.deleteNamespace('arm:a')

    expect(readdirSync(dir)).toEqual(['secrets.bin'])
  })

  it('throws and writes nothing when encryption is not available', () => {
    const store = createSecureStore(filePath, fakeCipher(false))

    expect(() => store.set('arm:a', 'k', 'plain-secret')).toThrow(SecureStoreError)
    try {
      store.set('arm:a', 'k', 'plain-secret')
    } catch (error) {
      expect((error as SecureStoreError).code).toBe('unavailable')
      expect((error as Error).message).not.toContain('plain-secret')
    }
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports an unreadable file without leaking its content', () => {
    const writer = createSecureStore(filePath, fakeCipher())
    writer.set('arm:a', 'k', 'secret-x')

    const broken: SecretCipher = {
      isAvailable: () => true,
      encrypt: (plain) => xor(Buffer.from(plain, 'utf8')),
      decrypt: () => {
        throw new Error('bad key')
      }
    }

    try {
      createSecureStore(filePath, broken).get('arm:a', 'k')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SecureStoreError)
      expect((error as SecureStoreError).code).toBe('unreadable')
    }
  })
})
