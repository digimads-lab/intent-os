import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { apiKeyStore } from '../ai-provider/api-key-store'

const MARKER_FILE = () => path.join(app.getPath('userData'), 'onboarding-complete')

/**
 * Check if onboarding is needed.
 * Returns true if no API key has been configured yet AND the marker file does not exist.
 */
export async function isOnboardingNeeded(): Promise<boolean> {
  // If API key already exists, treat as already onboarded
  const hasKey = await apiKeyStore.hasApiKey()
  if (hasKey) {
    return false
  }

  // Check marker file
  try {
    await fs.access(MARKER_FILE())
    return false
  } catch {
    return true
  }
}

/**
 * Mark onboarding as completed (write a marker file).
 */
export async function markOnboardingComplete(): Promise<void> {
  await fs.writeFile(MARKER_FILE(), new Date().toISOString(), 'utf8')
}
