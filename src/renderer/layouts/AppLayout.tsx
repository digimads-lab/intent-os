import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'

export function AppLayout() {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-slate-900 p-6">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
