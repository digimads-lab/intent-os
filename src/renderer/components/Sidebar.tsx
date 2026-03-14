import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Puzzle, Wand2, Settings } from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '应用' },
  { to: '/skills', icon: Puzzle, label: 'Skill' },
  { to: '/generate', icon: Wand2, label: '生成' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export function Sidebar() {
  return (
    <nav className="w-14 bg-slate-800 flex flex-col items-center py-4 gap-2 border-r border-slate-700">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 p-2 rounded-lg w-10 text-xs transition-colors ${
              isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`
          }
        >
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
