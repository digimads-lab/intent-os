import { useState } from 'react'
import { X, FolderOpen, Loader2 } from 'lucide-react'

interface RegisterDialogProps {
  onClose: () => void
  onRegister: (directoryPath: string) => Promise<void>
}

export function RegisterDialog({ onClose, onRegister }: RegisterDialogProps) {
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = path.trim()
    if (!trimmed) {
      setError('请输入 Skill 目录路径')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await onRegister(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 mx-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-700"
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <FolderOpen size={18} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-slate-100 font-semibold text-base">注册 Skill</h2>
            <p className="text-slate-500 text-xs mt-0.5">从本地目录加载 Skill</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="skill-path" className="text-xs font-medium text-slate-400">
              Skill 目录路径
            </label>
            <input
              id="skill-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/yourname/my-skill"
              disabled={loading}
              autoFocus
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
            <p className="text-xs text-slate-600">
              目录下必须包含 <code className="text-slate-500">skill.json</code> 文件
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
              <span className="text-red-400 text-xs leading-relaxed">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !path.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  注册中…
                </>
              ) : (
                '注册 Skill'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
