import { useState, useEffect } from 'react'
import { useProviderStore } from '../../stores/provider-store'
import { useGenerationStore } from '../generation/generation-store'
import { useModificationStore } from '../../stores/modification-store'
import type { ProviderStatus } from '@intentos/shared-types'

type ProviderChoice = 'claude-api' | 'custom'

const STATUS_CONFIG: Record<ProviderStatus, { color: string; label: string }> = {
  ready: { color: 'bg-green-500', label: '已连接' },
  error: { color: 'bg-red-500', label: '连接错误' },
  rate_limited: { color: 'bg-yellow-500', label: 'API 配额受限' },
  initializing: { color: 'bg-yellow-500', label: '初始化中...' },
  uninitialized: { color: 'bg-slate-500', label: '未配置' },
  disposing: { color: 'bg-slate-500', label: '正在断开...' },
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

function getPrivacyNotice(provider: ProviderChoice, baseUrl: string): string {
  if (provider === 'claude-api') {
    return '使用 Claude API 时，您的意图描述和 Skill 信息将发送至 Anthropic 服务器。'
  }
  try {
    const host = new URL(baseUrl).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return '当前配置使用本地端点，数据不会离开您的设备。'
    }
    return `使用自定义 Provider 时，数据将发送至 ${host}。`
  } catch {
    return '使用自定义 Provider 时，数据将发送至配置的端点。'
  }
}

export function SettingsPage() {
  const { status, initStatusListener } = useProviderStore()
  const generationSessionId = useGenerationStore((s) => s.sessionId)
  const modificationSessionId = useModificationStore((s) => s.sessionId)
  const hasActiveSession = generationSessionId !== null || modificationSessionId !== null

  const [provider, setProvider] = useState<ProviderChoice>('claude-api')
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [pendingProvider, setPendingProvider] = useState<ProviderChoice | null>(null)

  // Custom provider fields
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customPlanModel, setCustomPlanModel] = useState('')
  const [customCodegenModel, setCustomCodegenModel] = useState('')

  useEffect(() => {
    const cleanup = initStatusListener()
    return cleanup
  }, [initStatusListener])

  // Load saved custom config on mount
  useEffect(() => {
    window.intentOS.settings.getCustomProviderConfig().then((result) => {
      if (result.config) {
        setCustomBaseUrl(result.config.customBaseUrl)
        setCustomPlanModel(result.config.customPlanModel)
        setCustomCodegenModel(result.config.customCodegenModel)
      }
    }).catch(() => {})
  }, [])

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      if (provider === 'claude-api') {
        await window.intentOS.settings.saveApiKey(apiKey)
        const result = await window.intentOS.settings.testConnection()
        setTestResult({
          success: result.success,
          message: result.success
            ? `连接成功（延迟 ${result.latencyMs}ms）`
            : (result.error ?? '连接失败'),
        })
      } else {
        // Save custom config and switch provider to test
        await window.intentOS.settings.setCustomProviderConfig({
          baseUrl: customBaseUrl,
          planModel: customPlanModel,
          codegenModel: customCodegenModel,
          apiKey: customApiKey || undefined,
        })
        const switchResult = await window.intentOS.settings.setProvider({ providerId: 'custom' })
        if (switchResult.success) {
          setTestResult({ success: true, message: '连接成功' })
        } else {
          setTestResult({
            success: false,
            message: switchResult.error?.message ?? '连接失败',
          })
        }
      }
    } catch (err) {
      setTestResult({ success: false, message: String(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSaveCustomConfig = async () => {
    setSaving(true)
    try {
      await window.intentOS.settings.setCustomProviderConfig({
        baseUrl: customBaseUrl,
        planModel: customPlanModel,
        codegenModel: customCodegenModel,
        apiKey: customApiKey || undefined,
      })
      setTestResult({ success: true, message: '配置已保存' })
    } catch (err) {
      setTestResult({ success: false, message: String(err) })
    } finally {
      setSaving(false)
    }
  }

  const statusConfig = STATUS_CONFIG[status] ?? STATUS_CONFIG['uninitialized']
  const customUrlValid = !customBaseUrl || isValidUrl(customBaseUrl)
  const customFormValid =
    customBaseUrl.trim() !== '' &&
    customUrlValid &&
    customPlanModel.trim() !== '' &&
    customCodegenModel.trim() !== ''

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 text-slate-200">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-slate-100 mb-6">设置</h1>

        {/* AI Provider Section */}
        <section className="mb-8">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
            AI Provider
          </h2>

          <div className="space-y-4">
            {/* Provider selector */}
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Provider</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none appearance-none"
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as ProviderChoice
                  if (hasActiveSession) {
                    setPendingProvider(next)
                  } else {
                    setProvider(next)
                    setTestResult(null)
                  }
                }}
              >
                <option value="claude-api">Claude API (Anthropic)</option>
                <option value="custom">自定义（OpenAI 兼容）</option>
                <option value="openclaw" disabled>
                  OpenClaw（即将推出）
                </option>
              </select>
            </div>

            {/* Claude API fields */}
            {provider === 'claude-api' && (
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">API Key</label>
                <input
                  type="password"
                  className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none"
                  placeholder="sk-ant-api03-..."
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setTestResult(null)
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  前往{' '}
                  <span className="text-slate-400">console.anthropic.com</span> 获取 API Key
                </p>
              </div>
            )}

            {/* Custom provider fields */}
            {provider === 'custom' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5">Base URL *</label>
                  <input
                    type="text"
                    className={`w-full bg-slate-800 border rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none ${
                      !customUrlValid ? 'border-red-500' : 'border-slate-600'
                    }`}
                    placeholder="http://localhost:11434/v1"
                    value={customBaseUrl}
                    onChange={(e) => {
                      setCustomBaseUrl(e.target.value)
                      setTestResult(null)
                    }}
                  />
                  {!customUrlValid && (
                    <p className="mt-1 text-xs text-red-400">URL 格式不合法</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-1.5">API Key</label>
                  <input
                    type="password"
                    className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none"
                    placeholder="可选（本地服务可留空）"
                    value={customApiKey}
                    onChange={(e) => {
                      setCustomApiKey(e.target.value)
                      setTestResult(null)
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-1.5">规划模型 *</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none"
                    placeholder="gpt-4o"
                    value={customPlanModel}
                    onChange={(e) => {
                      setCustomPlanModel(e.target.value)
                      setTestResult(null)
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-1.5">代码生成模型 *</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none"
                    placeholder="gpt-4o"
                    value={customCodegenModel}
                    onChange={(e) => {
                      setCustomCodegenModel(e.target.value)
                      setTestResult(null)
                    }}
                  />
                </div>

                {/* Save button for custom config */}
                <button
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  onClick={handleSaveCustomConfig}
                  disabled={saving || !customFormValid}
                >
                  {saving ? '保存中...' : '保存配置'}
                </button>
              </div>
            )}

            {/* Connection status row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                <span>{statusConfig.label}</span>
              </div>

              {/* Test connection button */}
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleTestConnection}
                disabled={
                  testing ||
                  (provider === 'claude-api' && !apiKey.trim()) ||
                  (provider === 'custom' && !customFormValid)
                }
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
            </div>

            {/* Test result feedback */}
            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${
                  testResult.success
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
              >
                <span className="mt-0.5 shrink-0">{testResult.success ? '✓' : '✕'}</span>
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Privacy notice */}
            <div className="bg-slate-700 border border-slate-600 rounded-md p-3 text-xs text-slate-400 flex items-start gap-2">
              <svg
                className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{getPrivacyNotice(provider, customBaseUrl)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Provider switch confirmation dialog */}
      {pendingProvider !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-100 mb-2">切换 Provider</h3>
            <p className="text-sm text-slate-400 mb-6">
              当前有活跃的生成/规划会话，切换 Provider 将中断该会话。是否继续？
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-md border border-slate-600 text-sm text-slate-300 hover:text-white hover:border-slate-400 transition-colors"
                onClick={() => setPendingProvider(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-sm text-white font-semibold transition-colors"
                onClick={() => {
                  setProvider(pendingProvider)
                  setTestResult(null)
                  setPendingProvider(null)
                }}
              >
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
