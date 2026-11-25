import type { SecretCipher } from './secureStore'

/** Electron safeStorage 중 쓰는 부분(시험에서는 가짜를 넣는다) */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptString(plain: string): Buffer
  decryptString(data: Buffer): string
}

/**
 * Electron safeStorage 로 만든 cipher. app ready 이후에 부른다.
 * 암호화를 쓸 수 있는지는 (지원 중단 예정인 동기 isEncryptionAvailable 대신) 비동기 확인을 한 번 기다려 정한다.
 * 확인이 실패하거나 던지면 "쓸 수 없음"으로 보고, 그러면 보안 저장소는 평문으로 저장하지 않고 오류를 낸다.
 */
export async function createSafeStorageCipher(storage: SafeStorageLike): Promise<SecretCipher> {
  let available = false
  try {
    available = await storage.isAsyncEncryptionAvailable()
  } catch {
    available = false
  }
  return {
    isAvailable: () => available,
    encrypt: (plain) => storage.encryptString(plain),
    decrypt: (data) => storage.decryptString(data)
  }
}
