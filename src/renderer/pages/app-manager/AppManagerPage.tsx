import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, AppWindow } from 'lucide-react'
import type { AppRegistration } from '@intentos/shared-types'
import { useAppStore } from './app-store'
import { AppCard } from './AppCard'

// ── Skeleton card ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-3 animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-4 bg-slate-700 rounded w-2/3" />
        <div className="h-3 bg-slate-700/60 rounded w-full" />
        <div className="h-3 bg-slate-700/60 rounded w-4/5" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 w-20 bg-slate-700/60 rounded-md" />
        <div className="h-5 w-16 bg-slate-700/60 rounded-md" />
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-slate-700/60">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-700" />
          <div className="h-5 w-16 bg-slate-700/60 rounded-full" />
        </div>
        <div className="h-7 w-16 bg-slate-700/60 rounded-lg" />
      </div>
    </div>
  )
}

// ── Uninstall confirm dialog ───────────────────────────────────────────────────

interface UninstallDialogProps {
  app: AppRegistration
  onClose: () => void
  onConfirm: () => void
}

function UninstallDialog({ app, onClose, onConfirm }: UninstallDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-slate-100 font-semibold text-base mb-2">卸载应用</h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          确定要卸载{' '}
          <span className="text-slate-200 font-medium">{app.name}</span>{' '}
          吗？此操作将停止进程并删除应用数据，无法撤销。
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
          >
            确认卸载
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AppManagerPage ─────────────────────────────────────────────────────────────

export function AppManagerPage() {
  const navigate = useNavigate()
  const { apps, isLoading, error, fetchApps, launchApp, stopApp, focusApp, uninstallApp, updateAppStatus } =
    useAppStore()

  const [uninstallTarget, setUninstallTarget] = useState<AppRegistration | null>(null)

  // Fetch on mount + subscribe to live status events
  useEffect(() => {
    void fetchApps()

    const unsubscribe = window.intentOS.app.onStatusChanged((event) => {
      updateAppStatus(event)
    })

    return () => {
      unsubscribe()
    }
  }, [fetchApps, updateAppStatus])

  const handleLaunch = (appId: string) => {
    void launchApp(appId)
  }

  const handleStop = (appId: string) => {
    void stopApp(appId)
  }

  const handleFocus = (appId: string) => {
    void focusApp(appId)
  }

  const handleUninstallRequest = (appId: string) => {
    const app = apps.find((a) => a.id === appId)
    if (app) setUninstallTarget(app)
  }

  const handleConfirmUninstall = async () => {
    if (!uninstallTarget) return
    await uninstallApp(uninstallTarget.id)
    setUninstallTarget(null)
  }

  return (
    <div className="flex flex-col h-full gap-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">应用管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            管理已生成的 SkillApp，共 {apps.length} 个
          </p>
        </div>

        <button
          onClick={() => void navigate('/generate')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          <Plus size={16} />
          新建应用
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      {isLoading && apps.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : apps.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
            <AppWindow size={28} className="text-slate-600" />
          </div>
          <div>
            <p className="text-slate-300 font-medium">还没有应用，去生成一个吧</p>
            <p className="text-sm text-slate-500 mt-1">
              选择 Skill 后，AI 将为你生成一个独立的 SkillApp
            </p>
          </div>
          <button
            onClick={() => void navigate('/generate')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            生成第一个应用
          </button>
        </div>
      ) : (
        /* App grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {apps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onLaunch={handleLaunch}
              onStop={handleStop}
              onFocus={handleFocus}
              onUninstall={handleUninstallRequest}
            />
          ))}
        </div>
      )}

      {/* Uninstall confirmation dialog */}
      {uninstallTarget && (
        <UninstallDialog
          app={uninstallTarget}
          onClose={() => setUninstallTarget(null)}
          onConfirm={() => void handleConfirmUninstall()}
        />
      )}
    </div>
  )
}
