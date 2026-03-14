import { useEffect, useState } from 'react'
import { createHashRouter, Navigate, Outlet } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { SkillManagerPage } from './pages/skill-manager/SkillManagerPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { AppManagerPage } from './pages/app-manager/AppManagerPage'
import { GenerationWindow } from './pages/generation/GenerationWindow'
import { OnboardingWizard } from './pages/onboarding'

/**
 * Root wrapper: checks whether onboarding is needed.
 * If needed, redirects to /onboarding; otherwise renders child routes.
 */
function OnboardingGate(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    window.intentOS.onboarding
      .check()
      .then(({ needed }) => {
        setNeedsOnboarding(needed)
        setReady(true)
      })
      .catch(() => {
        setReady(true)
      })
  }, [])

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}

export const router = createHashRouter([
  {
    path: '/',
    element: <OnboardingGate />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <AppManagerPage /> },
          { path: 'skills', element: <SkillManagerPage /> },
          { path: 'generate', element: <GenerationWindow /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  {
    path: '/onboarding',
    element: <OnboardingWizard />,
  },
])
