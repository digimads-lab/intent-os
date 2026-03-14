import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Step = 1 | 2 | 3 | 4
type ProviderChoice = 'claude-api' | 'custom'

interface ConnectionState {
  status: 'idle' | 'loading' | 'success' | 'error'
  error?: string
}

export function OnboardingWizard(): JSX.Element {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [selectedProvider, setSelectedProvider] = useState<ProviderChoice>('claude-api')
  const [apiKey, setApiKey] = useState('')
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' })

  // Custom provider fields
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customPlanModel, setCustomPlanModel] = useState('')
  const [customCodegenModel, setCustomCodegenModel] = useState('')

  const goNext = (): void => {
    if (step < 4) setStep((s) => (s + 1) as Step)
  }

  const goBack = (): void => {
    if (step > 1) setStep((s) => (s - 1) as Step)
  }

  const handleTestConnection = async (): Promise<void> => {
    setConnection({ status: 'loading' })
    try {
      if (selectedProvider === 'claude-api') {
        await window.intentOS.settings.saveApiKey(apiKey)
        const result = await window.intentOS.settings.testConnection()
        if (result.success) {
          setConnection({ status: 'success' })
        } else {
          setConnection({ status: 'error', error: result.error ?? '未知错误' })
        }
      } else {
        await window.intentOS.settings.setCustomProviderConfig({
          baseUrl: customBaseUrl,
          planModel: customPlanModel,
          codegenModel: customCodegenModel,
          apiKey: customApiKey || undefined,
        })
        const switchResult = await window.intentOS.settings.setProvider({ providerId: 'custom' })
        if (switchResult.success) {
          setConnection({ status: 'success' })
        } else {
          setConnection({ status: 'error', error: switchResult.error?.message ?? '连接失败' })
        }
      }
    } catch (err) {
      setConnection({ status: 'error', error: String(err) })
    }
  }

  const handleStartUsing = async (): Promise<void> => {
    await window.intentOS.onboarding.complete()
    navigate('/')
  }

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center bg-gray-950 text-white"
      data-testid="onboarding-wizard"
    >
      {/* Step indicator */}
      <div className="flex gap-2 mb-10">
        {([1, 2, 3, 4] as Step[]).map((s) => (
          <div
            key={s}
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              s === step ? 'bg-blue-500' : 'bg-gray-600'
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="w-full max-w-md px-6">
        {step === 1 && (
          <div data-testid="onboarding-step-1">
            <h1 className="text-3xl font-bold text-center mb-2">欢迎使用 IntentOS</h1>
            <p className="text-gray-400 text-center mb-8">请选择 AI Provider</p>

            <div className="space-y-3">
              {/* Claude API */}
              <button
                type="button"
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors ${
                  selectedProvider === 'claude-api'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                }`}
                onClick={() => setSelectedProvider('claude-api')}
                data-testid="provider-claude"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-lg font-bold">
                  C
                </div>
                <div>
                  <div className="font-semibold">Claude API</div>
                  <div className="text-sm text-gray-400">Anthropic</div>
                </div>
                {selectedProvider === 'claude-api' && (
                  <div className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-xs">
                    ✓
                  </div>
                )}
              </button>

              {/* Custom (OpenAI-compatible) */}
              <button
                type="button"
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors ${
                  selectedProvider === 'custom'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                }`}
                onClick={() => setSelectedProvider('custom')}
                data-testid="provider-custom"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-lg font-bold">
                  O
                </div>
                <div>
                  <div className="font-semibold">自定义（OpenAI 兼容）</div>
                  <div className="text-sm text-gray-400">Ollama / OpenAI / Azure 等</div>
                </div>
                {selectedProvider === 'custom' && (
                  <div className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-xs">
                    ✓
                  </div>
                )}
              </button>

              {/* OpenClaw — coming soon */}
              <div
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed"
                data-testid="provider-openclaw"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-lg font-bold">
                  O
                </div>
                <div>
                  <div className="font-semibold text-gray-400">OpenClaw</div>
                  <div className="text-sm text-gray-500">即将推出</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div data-testid="onboarding-step-2">
            {selectedProvider === 'claude-api' ? (
              <>
                <h1 className="text-3xl font-bold text-center mb-8">输入 Anthropic API Key</h1>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
                  data-testid="api-key-input"
                />
                <p className="text-sm text-blue-400 cursor-pointer hover:text-blue-300 text-center">
                  在 Anthropic 控制台获取 API Key →
                </p>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold text-center mb-8">配置自定义 Provider</h1>
                <div className="space-y-4">
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="Base URL (如 http://localhost:11434/v1)"
                    className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    data-testid="custom-base-url-input"
                  />
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="API Key（可选）"
                    className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    data-testid="custom-api-key-input"
                  />
                  <input
                    type="text"
                    value={customPlanModel}
                    onChange={(e) => setCustomPlanModel(e.target.value)}
                    placeholder="规划模型名（如 gpt-4o）"
                    className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    data-testid="custom-plan-model-input"
                  />
                  <input
                    type="text"
                    value={customCodegenModel}
                    onChange={(e) => setCustomCodegenModel(e.target.value)}
                    placeholder="代码生成模型名（如 gpt-4o）"
                    className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    data-testid="custom-codegen-model-input"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div data-testid="onboarding-step-3">
            <h1 className="text-3xl font-bold text-center mb-8">测试连接</h1>

            <div className="flex flex-col items-center gap-6">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={connection.status === 'loading'}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
                data-testid="btn-test-connection"
              >
                {connection.status === 'loading' ? '测试中...' : '开始测试'}
              </button>

              {connection.status === 'loading' && (
                <div
                  className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
                  data-testid="connection-status"
                />
              )}

              {connection.status === 'success' && (
                <div
                  className="text-green-400 font-semibold text-lg"
                  data-testid="connection-status"
                >
                  ✓ 连接成功
                </div>
              )}

              {connection.status === 'error' && (
                <div
                  className="text-red-400 font-semibold text-center"
                  data-testid="connection-status"
                >
                  ✗ 连接失败: {connection.error}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div data-testid="onboarding-step-4" className="text-center">
            <h1 className="text-3xl font-bold mb-3">配置完成！</h1>
            <p className="text-gray-400 mb-10">IntentOS 已准备就绪</p>

            <button
              type="button"
              onClick={handleStartUsing}
              className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-lg transition-colors"
              data-testid="btn-start-using"
            >
              开始使用
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-4 mt-10">
        {step > 1 && (
          <button
            type="button"
            onClick={goBack}
            className="px-6 py-2 rounded-xl border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white transition-colors"
            data-testid="btn-back"
          >
            上一步
          </button>
        )}

        {step < 4 && (
          <button
            type="button"
            onClick={goNext}
            disabled={
              step === 2 &&
              (selectedProvider === 'claude-api'
                ? apiKey.trim() === ''
                : !customBaseUrl.trim() || !customPlanModel.trim() || !customCodegenModel.trim())
            }
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
            data-testid="btn-next"
          >
            下一步
          </button>
        )}
      </div>
    </div>
  )
}
