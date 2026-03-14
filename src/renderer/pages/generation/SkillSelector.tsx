import { useEffect, useState } from 'react'
import { Puzzle, Wand2, AlertCircle } from 'lucide-react'
import type { SkillRegistration } from '@intentos/shared-types'
import { useGenerationStore } from './generation-store'

export function SkillSelector() {
  const { startPlan, genError, isPlanning } = useGenerationStore()

  const [skills, setSkills] = useState<SkillRegistration[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [intent, setIntent] = useState('')

  useEffect(() => {
    void (async () => {
      setLoadingSkills(true)
      try {
        const list = await window.intentOS.skill.getInstalled()
        setSkills(list)
      } catch (err) {
        setSkillsError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingSkills(false)
      }
    })()
  }, [])

  const toggleSkill = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const canStart = selectedIds.size > 0 && intent.trim().length > 0 && !isPlanning

  const handleStart = async () => {
    if (!canStart) return
    try {
      await startPlan(Array.from(selectedIds), intent.trim())
    } catch {
      // error is already stored in genError
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Skill list */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-300">
          选择 Skill
          <span className="ml-2 text-xs text-slate-500">（至少选择一个）</span>
        </label>

        {loadingSkills ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-16 bg-slate-800 border border-slate-700 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : skillsError ? (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>加载 Skill 失败：{skillsError}</span>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 bg-slate-800/50 border border-slate-700 border-dashed rounded-xl text-center">
            <Puzzle size={28} className="text-slate-600" />
            <div>
              <p className="text-sm text-slate-400">暂无已安装的 Skill</p>
              <p className="text-xs text-slate-500 mt-0.5">请先在 Skill 管理页面注册 Skill</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {skills.map((skill) => {
              const checked = selectedIds.has(skill.id)
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => toggleSkill(skill.id)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                    checked
                      ? 'bg-blue-600/15 border-blue-500/50 ring-1 ring-blue-500/30'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-800/80'
                  }`}
                >
                  {/* Checkbox indicator */}
                  <span
                    className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      checked
                        ? 'bg-blue-600 border-blue-500'
                        : 'border-slate-600 bg-slate-700'
                    }`}
                  >
                    {checked && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${checked ? 'text-blue-300' : 'text-slate-200'}`}>
                      {skill.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{skill.description}</p>
                    <p className="text-xs text-slate-600 mt-0.5">v{skill.version}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Intent textarea */}
      <div className="flex flex-col gap-2">
        <label htmlFor="intent-input" className="text-sm font-medium text-slate-300">
          描述你想要的应用
        </label>
        <textarea
          id="intent-input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="描述你想要的应用功能..."
          rows={4}
          className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all"
        />
        <p className="text-xs text-slate-600">
          {intent.trim().length} 字 · 尽量描述具体的功能和使用场景
        </p>
      </div>

      {/* Error from store */}
      {genError && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{genError.message}</span>
        </div>
      )}

      {/* Start button */}
      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={!canStart}
        className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
      >
        {isPlanning ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            正在启动规划...
          </>
        ) : (
          <>
            <Wand2 size={16} />
            开始规划
          </>
        )}
      </button>
    </div>
  )
}
