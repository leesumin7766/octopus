import { safeStorage } from 'electron'
import type { SecretCipher } from './secureStore'

/** Electron safeStorage 로 만든 cipher. app ready 이후에 호출한다. */
export function createSafeStorageCipher(): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
}
