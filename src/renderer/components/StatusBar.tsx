import { useEffect, useState } from 'react'
import { useProviderStore } from '../stores/provider-store'
import type { ProviderStatus } from '@intentos/shared-types'

function getStatusLabel(status: ProviderStatus, providerName: string): { color: string; label: string } {
  switch (status) {
    case 'ready':
      return { color: 'bg-green-500', label: `${providerName} 已连接` }
    case 'error':
      return { color: 'bg-red-500', label: `${providerName} 连接错误` }
    case 'rate_limited':
      return { color: 'bg-yellow-500', label: 'API 配额受限' }
    case 'initializing':
      return { color: 'bg-yellow-500', label: '初始化中...' }
    case 'uninitialized':
      return { color: 'bg-slate-500', label: '未配置 AI Provider' }
    case 'disposing':
      return { color: 'bg-slate-500', label: '正在断开...' }
    default:
      return { color: 'bg-slate-500', label: '未配置 AI Provider' }
  }
}

export function StatusBar() {
  const { status, initStatusListener } = useProviderStore()
  const [providerName, setProviderName] = useState('Claude API')

  useEffect(() => {
    const cleanup = initStatusListener()
    return cleanup
  }, [initStatusListener])

  // Fetch provider name when status changes to ready
  useEffect(() => {
    if (status === 'ready') {
      window.intentOS.settings.testConnection()
        .then((result) => {
          if (result.providerName) {
            setProviderName(result.providerName)
          }
        })
        .catch(() => {})
    }
  }, [status])

  const config = getStatusLabel(status, providerName)

  return (
    <div className="h-6 bg-slate-800 border-t border-slate-700 flex items-center px-3 gap-2 text-xs text-slate-400">
      <span className={`w-2 h-2 rounded-full ${config.color}`} />
      <span>{config.label}</span>
    </div>
  )
}
