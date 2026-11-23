import { describe, expect, it, vi } from 'vitest'
import { createSafeStorageCipher, type SafeStorageLike } from '../../src/main/platform/safeStorageCipher'
import { createSecureStore, SecureStoreError } from '../../src/main/platform/secureStore'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fake = (available: boolean | Error): SafeStorageLike & { sync: ReturnType<typeof vi.fn> } => ({
  sync: vi.fn(),
  isAsyncEncryptionAvailable: async () => {
    if (available instanceof Error) throw available
    return available
  },
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, '')
})

describe('safeStorage cipher', () => {
  it('asks the asynchronous availability check (never the deprecated synchronous one) and waits for it', async () => {
    const storage = { ...fake(true), isEncryptionAvailable: vi.fn(() => true) }
    const cipher = await createSafeStorageCipher(storage)
    expect(cipher.isAvailable()).toBe(true)
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled()
  })

  it('unavailable, or a check that throws, means "cannot encrypt"', async () => {
    expect((await createSafeStorageCipher(fake(false))).isAvailable()).toBe(false)
    expect((await createSafeStorageCipher(fake(new Error('no keychain')))).isAvailable()).toBe(false)
  })

  it('encrypts and decrypts through the storage', async () => {
    const cipher = await createSafeStorageCipher(fake(true))
    expect(cipher.decrypt(cipher.encrypt('비밀 값'))).toBe('비밀 값')
  })

  it('a secure store on an unavailable cipher refuses to save anything in plain text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'octopus-cipher-'))
    try {
      const store = createSecureStore(join(dir, 'secrets.bin'), await createSafeStorageCipher(fake(false)))
      expect(() => store.set('ns', 'k', 'v')).toThrow(SecureStoreError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
