import { useEffect, useState } from 'react'
import { Plus, Puzzle, RefreshCw } from 'lucide-react'
import type { SkillRegistration } from '@intentos/shared-types'
import { useSkillStore } from '../../stores/skill-store'
import { SkillCard } from './SkillCard'
import { RegisterDialog } from './RegisterDialog'
import { UninstallDialog } from './UninstallDialog'

interface UninstallTarget {
  skill: SkillRegistration
  hasApps: boolean
  appNames: string[]
}

export function SkillManagerPage() {
  const { skills, loading, error, fetchSkills, registerSkill, unregisterSkill } = useSkillStore()

  const [showRegister, setShowRegister] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<UninstallTarget | null>(null)

  useEffect(() => {
    void fetchSkills()
  }, [fetchSkills])

  const handleUninstallRequest = async (skill: SkillRegistration) => {
    try {
      const deps = await window.intentOS.skill.checkDependencies(skill.id)
      setUninstallTarget({
        skill,
        hasApps: deps.hasApps,
        appNames: deps.appNames,
      })
    } catch {
      // Fallback: show dialog without app info
      setUninstallTarget({ skill, hasApps: false, appNames: [] })
    }
  }

  const handleConfirmUninstall = async () => {
    if (!uninstallTarget) return
    await unregisterSkill(uninstallTarget.skill.id)
    setUninstallTarget(null)
  }

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Skill 管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            管理本地已安装的 Skill，共 {skills.length} 个
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchSkills()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="刷新列表"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            注册 Skill
          </button>
        </div>
      </div>

      {/* Global error banner */}
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      {loading && skills.length === 0 ? (
        /* Skeleton loader */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-3 animate-pulse"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2 flex-1">
                  <div className="h-4 bg-slate-700 rounded w-2/3" />
                  <div className="h-3 bg-slate-700/60 rounded w-1/3" />
                </div>
                <div className="h-6 w-16 bg-slate-700 rounded-full" />
              </div>
              <div className="h-3 bg-slate-700/60 rounded w-full" />
              <div className="h-3 bg-slate-700/60 rounded w-4/5" />
              <div className="flex gap-1.5">
                <div className="h-5 w-16 bg-slate-700/60 rounded-md" />
                <div className="h-5 w-20 bg-slate-700/60 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : skills.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
            <Puzzle size={28} className="text-slate-600" />
          </div>
          <div>
            <p className="text-slate-300 font-medium">暂无已安装的 Skill</p>
            <p className="text-sm text-slate-500 mt-1">
              点击右上角「注册 Skill」按钮，从本地目录加载 Skill
            </p>
          </div>
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            注册第一个 Skill
          </button>
        </div>
      ) : (
        /* Skill grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onUninstall={(s) => void handleUninstallRequest(s)}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      {showRegister && (
        <RegisterDialog
          onClose={() => setShowRegister(false)}
          onRegister={registerSkill}
        />
      )}

      {uninstallTarget && (
        <UninstallDialog
          skill={uninstallTarget.skill}
          hasApps={uninstallTarget.hasApps}
          appNames={uninstallTarget.appNames}
          onClose={() => setUninstallTarget(null)}
          onConfirm={handleConfirmUninstall}
        />
      )}
    </div>
  )
}
