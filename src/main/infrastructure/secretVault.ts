import { safeStorage } from 'electron'
import type { SecretVault } from '../contracts/agent'

export function createSecretVault(): SecretVault {
  return {
    encrypt: (key) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(key).toString('base64')
        : null,
    decrypt: (value) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(value, 'base64'))
        : ''
  }
}
