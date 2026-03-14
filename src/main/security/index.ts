export { registerNavigationGuard } from './navigation-guard'
export { configureCSP } from './csp'

import { registerNavigationGuard } from './navigation-guard'
import { configureCSP } from './csp'

export function initSecurity(): void {
  registerNavigationGuard()
  configureCSP()
}
