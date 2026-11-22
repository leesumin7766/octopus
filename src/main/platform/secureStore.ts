import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 암호화 수단. 실제 앱은 Electron safeStorage, 테스트는 가짜를 넣는다. */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface SecureStore {
  get(namespace: string, key: string): string | undefined
  set(namespace: string, key: string, value: string): void
  delete(namespace: string, key: string): void
  deleteNamespace(namespace: string): void
}

export type SecureStoreErrorCode = 'unavailable' | 'unreadable'

/** 메시지에는 비밀값·이름공간·키를 넣지 않는다. */
export class SecureStoreError extends Error {
  readonly code: SecureStoreErrorCode

  constructor(code: SecureStoreErrorCode, message: string) {
    super(message)
    this.name = 'SecureStoreError'
    this.code = code
  }
}

type Data = Map<string, Map<string, string>>

/**
 * 파일 하나에 이름공간별 키-값 비밀을 저장한다.
 * 파일 전체를 cipher 로 암호화하므로 이름공간·키 이름도 평문으로 남지 않는다.
 * 암호화를 쓸 수 없으면 평문으로 저장하지 않고 에러를 던진다.
 */
export function createSecureStore(filePath: string, cipher: SecretCipher): SecureStore {
  function assertAvailable(): void {
    if (!cipher.isAvailable()) {
      throw new SecureStoreError('unavailable', 'secure storage encryption is not available')
    }
  }

  function load(): Data {
    let raw: Buffer
    try {
      raw = readFileSync(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw new SecureStoreError('unreadable', 'secure store file could not be read')
    }

    try {
      const parsed = JSON.parse(cipher.decrypt(raw)) as Record<string, Record<string, string>>
      return new Map(
        Object.entries(parsed).map(([ns, entries]) => [ns, new Map(Object.entries(entries))])
      )
    } catch {
      // 원인 예외에는 복호화된 내용이 섞일 수 있어 붙이지 않는다.
      throw new SecureStoreError('unreadable', 'secure store file could not be decrypted')
    }
  }

  function save(data: Data): void {
    const plain = JSON.stringify(
      Object.fromEntries([...data].map(([ns, entries]) => [ns, Object.fromEntries(entries)]))
    )
    const encrypted = cipher.encrypt(plain)

    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp`
    try {
      writeFileSync(tempPath, encrypted, { mode: 0o600 })
      renameSync(tempPath, filePath)
    } catch (error) {
      rmSync(tempPath, { force: true })
      throw error
    }
  }

  return {
    get(namespace, key) {
      assertAvailable()
      return load().get(namespace)?.get(key)
    },

    set(namespace, key, value) {
      assertAvailable()
      const data = load()
      const entries = data.get(namespace) ?? new Map<string, string>()
      entries.set(key, value)
      data.set(namespace, entries)
      save(data)
    },

    delete(namespace, key) {
      assertAvailable()
      const data = load()
      const entries = data.get(namespace)
      if (!entries?.delete(key)) return
      if (entries.size === 0) data.delete(namespace)
      save(data)
    },

    deleteNamespace(namespace) {
      assertAvailable()
      const data = load()
      if (!data.delete(namespace)) return
      save(data)
    }
  }
}
