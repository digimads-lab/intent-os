/**
 * Platform detection for window opacity animation support
 */

export type SupportedPlatform = 'macos' | 'windows' | 'linux'

/**
 * Returns the current platform as a simplified string.
 */
export function getPlatform(): SupportedPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      return 'linux'
  }
}

/**
 * Linux: check for an X11/Wayland compositor via environment variables.
 * Returns true if any known compositor session env var is set.
 */
export function detectLinuxCompositor(): boolean {
  const compositorEnvVars = [
    'WAYLAND_DISPLAY',
    'GNOME_DESKTOP_SESSION_ID',
    'KDE_FULL_SESSION',
    'XFCE_SESSION',
  ]
  return compositorEnvVars.some((v) => Boolean(process.env[v]))
}

/**
 * Returns true if the current platform supports BrowserWindow opacity animations.
 * - macOS: always supported
 * - Windows: always supported (DWM compositor)
 * - Linux: only if a compositor is detected
 */
export function supportsOpacityAnimation(): boolean {
  const platform = getPlatform()
  if (platform === 'macos' || platform === 'windows') {
    return true
  }
  // Linux
  return detectLinuxCompositor()
}
