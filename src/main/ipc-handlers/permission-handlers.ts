/**
 * Permission IPC handler
 *
 * Registers the 'permission.request' JSON-RPC method on the SocketServer.
 * Incoming requests are checked against PermissionStore first; only unknown
 * (first-time) requests trigger a native dialog.showMessageBox() prompt.
 */

import { dialog } from 'electron'

import type { SocketServer } from '../modules/socket-server/socket-server'
import type { PermissionStore } from '../modules/permission-store'

/**
 * Expected params shape for the 'permission.request' RPC method.
 */
interface PermissionRequestParams {
  appId: string
  appName: string
  resource: string
  level: string
}

export function registerPermissionHandler(
  socketServer: SocketServer,
  permissionStore: PermissionStore
): void {
  socketServer.registerHandler(
    'permission.request',
    async (params, _session) => {
      const { appId, appName, resource, level } =
        params as unknown as PermissionRequestParams

      const status = permissionStore.getPermission(appId, resource, level)

      // Already decided — return immediately without showing a dialog
      if (status === 'granted') {
        return { granted: true }
      }
      if (status === 'denied') {
        return { granted: false }
      }

      // First-time request — ask the user
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'IntentOS 权限请求',
        message: `应用 ${appName} 请求 ${level} 访问 ${resource}`,
        buttons: ['允许', '拒绝'],
        defaultId: 0,
        cancelId: 1,
      })

      const granted = response === 0

      if (granted) {
        permissionStore.grantPermission(appId, resource, level)
      } else {
        permissionStore.denyPermission(appId, resource, level)
      }

      return { granted }
    }
  )
}
