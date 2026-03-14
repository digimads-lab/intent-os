/**
 * APIKeyStore — 跨平台安全存储 Anthropic API Key
 *
 * 环境变量支持说明：
 *   ANTHROPIC_API_KEY 环境变量优先级最高，可传入 Poe API key（格式：`3rb-...`）。
 *   配合 ANTHROPIC_BASE_URL 指向 Poe 端点使用，适合开发/测试场景。
 *   当 ANTHROPIC_API_KEY 存在时，saveApiKey / deleteApiKey 为 no-op，不影响真实存储。
 *
 * 存储方案：
 *   - 优先使用 Electron safeStorage（调用 OS Keychain / DPAPI / libsecret）
 *   - 加密不可用时（降级）：base64 编码写入同目录，仅限开发环境，启动时会 console.warn
 *
 * 文件路径：
 *   <userData>/intentos-api-key.enc  （safeStorage 加密模式）
 *   <userData>/intentos-api-key.b64  （base64 降级模式）
 */

import fs from 'fs/promises'
import path from 'path'

import { app, safeStorage } from 'electron'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type KeyProviderId = 'claude-api' | 'custom'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const ENC_FILE = () => path.join(app.getPath('userData'), 'intentos-api-key.enc')
const B64_FILE = () => path.join(app.getPath('userData'), 'intentos-api-key.b64')

/** Per-provider key file paths (CR-001) */
const providerEncFile = (providerId: KeyProviderId) =>
  path.join(app.getPath('userData'), `intentos-apikey-${providerId}.enc`)
const providerB64File = (providerId: KeyProviderId) =>
  path.join(app.getPath('userData'), `intentos-apikey-${providerId}.b64`)

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将 API Key mask 为安全可打印的形式。
 * 例：sk-ant-api03-abc...xyz → sk-ant-***...xyz
 * 仅保留前 7 个字符（"sk-ant-"）和后 4 个字符。
 */
function maskKey(key: string): string {
  if (key.length <= 11) return '***'
  return `${key.slice(0, 7)}***...${key.slice(-4)}`
}

// ─── 接口定义 ─────────────────────────────────────────────────────────────────

export interface APIKeyStore {
  /** @deprecated 使用 setKey('claude-api', key) 代替 */
  saveApiKey(key: string): Promise<void>
  /** @deprecated 使用 getKey('claude-api') 代替 */
  loadApiKey(): Promise<string | null>
  /** @deprecated 使用 deleteKey('claude-api') 代替 */
  deleteApiKey(): Promise<void>
  /** 检查是否存在已存储的 API Key（环境变量也算） */
  hasApiKey(): Promise<boolean>

  // ── CR-001: 多 Provider Key 存储 ─────────────────────────────────────────
  /** 按 providerId 存储 Key（加密，使用 safeStorage / OS Keychain） */
  setKey(providerId: KeyProviderId, key: string): Promise<void>
  /** 按 providerId 读取 Key，不存在返回 null */
  getKey(providerId: KeyProviderId): Promise<string | null>
  /** 按 providerId 删除 Key */
  deleteKey(providerId: KeyProviderId): Promise<void>
}

// ─── 实现 ─────────────────────────────────────────────────────────────────────

class ElectronAPIKeyStore implements APIKeyStore {
  // ── saveApiKey ──────────────────────────────────────────────────────────────

  async saveApiKey(key: string): Promise<void> {
    // 环境变量模式：no-op
    if (process.env.ANTHROPIC_API_KEY) {
      return
    }

    const encFile = ENC_FILE()

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        await fs.writeFile(encFile, encrypted)
      } else {
        // 降级：base64 编码（仅开发环境）
        console.warn(
          '[APIKeyStore] safeStorage 加密不可用，降级为 base64 存储（仅限开发环境）。' +
            ' API Key 未受 OS Keychain 保护。'
        )
        const encoded = Buffer.from(key, 'utf8').toString('base64')
        await fs.writeFile(B64_FILE(), encoded, 'utf8')
      }
    } catch (err) {
      throw new Error(
        `[APIKeyStore] 无法保存 API Key（${maskKey(key)}）：${(err as Error).message}`
      )
    }
  }

  // ── loadApiKey ──────────────────────────────────────────────────────────────

  async loadApiKey(): Promise<string | null> {
    // 环境变量优先（开发/测试/Poe API 兼容）
    const envKey = process.env.ANTHROPIC_API_KEY
    if (envKey) {
      return envKey
    }

    const encFile = ENC_FILE()

    if (safeStorage.isEncryptionAvailable()) {
      // safeStorage 加密模式
      let data: Buffer
      try {
        data = await fs.readFile(encFile)
      } catch (err: unknown) {
        // 文件不存在视为尚未配置
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        console.error('[APIKeyStore] 读取加密文件失败：', (err as Error).message)
        return null
      }

      try {
        const key = safeStorage.decryptString(data)
        return key
      } catch (err) {
        // 加密文件损坏（例如跨设备复制、safeStorage 密钥变更）
        console.error(
          '[APIKeyStore] 解密 API Key 失败（加密文件可能已损坏），请重新输入 API Key。',
          (err as Error).message
        )
        return null
      }
    } else {
      // 降级模式：读取 base64
      let encoded: string
      try {
        encoded = await fs.readFile(B64_FILE(), 'utf8')
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        console.error('[APIKeyStore] 读取 base64 文件失败：', (err as Error).message)
        return null
      }

      try {
        const key = Buffer.from(encoded.trim(), 'base64').toString('utf8')
        return key
      } catch (err) {
        console.error('[APIKeyStore] 解码 base64 API Key 失败：', (err as Error).message)
        return null
      }
    }
  }

  // ── deleteApiKey ────────────────────────────────────────────────────────────

  async deleteApiKey(): Promise<void> {
    // 环境变量模式：no-op
    if (process.env.ANTHROPIC_API_KEY) {
      return
    }

    const filesToRemove = [ENC_FILE(), B64_FILE()]

    for (const filePath of filesToRemove) {
      try {
        await fs.unlink(filePath)
      } catch (err: unknown) {
        // 文件不存在时静默跳过
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[APIKeyStore] 删除文件 ${filePath} 失败：`, (err as Error).message)
        }
      }
    }
  }

  // ── hasApiKey ───────────────────────────────────────────────────────────────

  async hasApiKey(): Promise<boolean> {
    // 环境变量视为已配置
    if (process.env.ANTHROPIC_API_KEY) {
      return true
    }

    const encFile = ENC_FILE()

    // 检查加密文件或 base64 文件是否存在
    const candidates = safeStorage.isEncryptionAvailable() ? [encFile] : [B64_FILE()]

    for (const filePath of candidates) {
      try {
        await fs.access(filePath)
        return true
      } catch {
        // 文件不存在，继续检查下一个
      }
    }

    return false
  }

  // ── CR-001: setKey ──────────────────────────────────────────────────────────

  async setKey(providerId: KeyProviderId, key: string): Promise<void> {
    // claude-api 兼容：环境变量模式下 no-op
    if (providerId === 'claude-api' && process.env.ANTHROPIC_API_KEY) {
      return
    }

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        await fs.writeFile(providerEncFile(providerId), encrypted)
      } else {
        console.warn(
          `[APIKeyStore] safeStorage 加密不可用，降级为 base64 存储 (${providerId})。`
        )
        const encoded = Buffer.from(key, 'utf8').toString('base64')
        await fs.writeFile(providerB64File(providerId), encoded, 'utf8')
      }
    } catch (err) {
      throw new Error(
        `[APIKeyStore] 无法保存 API Key (${providerId})：${(err as Error).message}`
      )
    }
  }

  // ── CR-001: getKey ──────────────────────────────────────────────────────────

  async getKey(providerId: KeyProviderId): Promise<string | null> {
    // claude-api 兼容：环境变量优先
    if (providerId === 'claude-api') {
      const envKey = process.env.ANTHROPIC_API_KEY
      if (envKey) return envKey
    }

    if (safeStorage.isEncryptionAvailable()) {
      let data: Buffer
      try {
        data = await fs.readFile(providerEncFile(providerId))
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        console.error(`[APIKeyStore] 读取加密文件失败 (${providerId})：`, (err as Error).message)
        return null
      }
      try {
        return safeStorage.decryptString(data)
      } catch (err) {
        console.error(`[APIKeyStore] 解密失败 (${providerId})：`, (err as Error).message)
        return null
      }
    } else {
      let encoded: string
      try {
        encoded = await fs.readFile(providerB64File(providerId), 'utf8')
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        console.error(`[APIKeyStore] 读取 base64 文件失败 (${providerId})：`, (err as Error).message)
        return null
      }
      try {
        return Buffer.from(encoded.trim(), 'base64').toString('utf8')
      } catch (err) {
        console.error(`[APIKeyStore] 解码失败 (${providerId})：`, (err as Error).message)
        return null
      }
    }
  }

  // ── CR-001: deleteKey ────────────────────────────────────────────────────────

  async deleteKey(providerId: KeyProviderId): Promise<void> {
    if (providerId === 'claude-api' && process.env.ANTHROPIC_API_KEY) {
      return
    }

    const filesToRemove = [providerEncFile(providerId), providerB64File(providerId)]

    for (const filePath of filesToRemove) {
      try {
        await fs.unlink(filePath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[APIKeyStore] 删除文件 ${filePath} 失败：`, (err as Error).message)
        }
      }
    }
  }
}

// ─── 导出单例 ─────────────────────────────────────────────────────────────────

export const apiKeyStore: APIKeyStore = new ElectronAPIKeyStore()
