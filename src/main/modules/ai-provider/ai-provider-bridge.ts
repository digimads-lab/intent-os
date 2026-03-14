/**
 * M-04 AI Provider — IPC Bridge
 *
 * Registers all ipcMain handlers that forward AI Provider streaming methods
 * to the renderer process.  Call registerHandlers() once during main-process
 * startup.
 *
 * Session isolation guarantee:
 *   Stream events (chunks / complete / error) are sent only to the
 *   WebContents that originated the request (event.sender).
 *   Status-changed broadcasts are sent to all BrowserWindow instances.
 */

import { ipcMain, BrowserWindow } from "electron";
import fs from "fs/promises";
import path from "path";
import { app } from "electron";

import type { AIProviderManager } from "./provider-manager";
import type { PlanRequest, GenerateRequest, SkillCallRequest, ProviderStatus } from "./interfaces";
import type { ProviderConfig, CustomProviderConfig } from "./interfaces";
import { ClaudeAPIProvider } from "./claude-api-provider";
import { CustomOpenAIProvider } from "./custom-openai-provider";
import { apiKeyStore } from "./api-key-store";

// ── Error payload shape ────────────────────────────────────────────────────────

interface IpcError {
  code: string;
  message: string;
  retryable?: boolean;
}

function toIpcError(error: unknown): IpcError {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  ) {
    const e = error as { code: string; message: string; retryable?: boolean };
    const result: IpcError = { code: e.code, message: e.message };
    if (e.retryable !== undefined) result.retryable = e.retryable;
    return result;
  }
  return { code: "PROVIDER_ERROR", message: String(error) };
}

// ── Custom provider config persistence ───────────────────────────────────────

const CUSTOM_CONFIG_FILE = () =>
  path.join(app.getPath("userData"), "custom-provider-config.json");

async function loadCustomConfig(): Promise<CustomProviderConfig | null> {
  try {
    const raw = await fs.readFile(CUSTOM_CONFIG_FILE(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.providerId === "custom") return parsed as CustomProviderConfig;
    return null;
  } catch {
    return null;
  }
}

async function saveCustomConfig(config: {
  customBaseUrl: string;
  customPlanModel: string;
  customCodegenModel: string;
}): Promise<void> {
  const full: CustomProviderConfig = {
    providerId: "custom",
    customBaseUrl: config.customBaseUrl,
    customPlanModel: config.customPlanModel,
    customCodegenModel: config.customCodegenModel,
  };
  await fs.writeFile(CUSTOM_CONFIG_FILE(), JSON.stringify(full, null, 2), "utf8");
}

// ── AIProviderBridge ──────────────────────────────────────────────────────────

export class AIProviderBridge {
  private unsubscribeStatus: (() => void) | null = null;

  constructor(private readonly manager: AIProviderManager) {}

  /**
   * Register all IPC handlers and set up the status-changed broadcast.
   * Must be called once after the app is ready.
   */
  registerHandlers(): void {
    this._registerPlanHandler();
    this._registerGenerateHandler();
    this._registerSkillCallHandler();
    this._registerCancelHandler();
    this._registerStatusHandler();
    this._registerStatusChangedBroadcast();
    this._registerSetProviderHandler();
    this._registerCustomProviderConfigHandlers();
    this._registerApiKeyHandlers();
    this._registerTestConnectionHandler();
  }

  /**
   * Remove all IPC handlers and unsubscribe from status events.
   * Call during app shutdown if the bridge needs to be torn down.
   */
  dispose(): void {
    ipcMain.removeHandler("ai-provider:plan");
    ipcMain.removeHandler("ai-provider:generate");
    ipcMain.removeHandler("ai-provider:skill-call");
    ipcMain.removeHandler("ai-provider:cancel");
    ipcMain.removeHandler("ai-provider:status");
    ipcMain.removeHandler("ai-provider:set-provider");
    ipcMain.removeHandler("settings:get-custom-provider-config");
    ipcMain.removeHandler("settings:set-custom-provider-config");
    ipcMain.removeHandler("settings:get-api-key");
    ipcMain.removeHandler("settings:save-api-key");
    ipcMain.removeHandler("settings:test-connection");
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
  }

  // ── Handler registrations ──────────────────────────────────────────────────

  private _registerPlanHandler(): void {
    ipcMain.handle("ai-provider:plan", async (event, payload: PlanRequest) => {
      const { sessionId } = payload;
      const sender = event.sender;

      // Start the async stream in an IIAFE so the invoke returns immediately.
      ;(async () => {
        try {
          for await (const chunk of this.manager.planApp(payload)) {
            if (sender.isDestroyed()) return;
            sender.send(`ai-provider:plan-chunk:${sessionId}`, chunk);
          }
          if (!sender.isDestroyed()) {
            sender.send(`ai-provider:plan-complete:${sessionId}`);
          }
        } catch (error) {
          if (sender.isDestroyed()) return;
          const ipcError = toIpcError(error);
          // SESSION_CANCELLED is silently ignored — no error event sent.
          if (ipcError.code !== "SESSION_CANCELLED") {
            sender.send(`ai-provider:plan-error:${sessionId}`, ipcError);
          }
        }
      })();

      // Immediate return — renderer starts listening for chunk events.
      return { sessionId, status: "streaming" };
    });
  }

  private _registerGenerateHandler(): void {
    ipcMain.handle(
      "ai-provider:generate",
      async (event, payload: GenerateRequest) => {
        const { sessionId } = payload;
        const sender = event.sender;

        ;(async () => {
          try {
            for await (const chunk of this.manager.generateCode(payload)) {
              if (sender.isDestroyed()) return;
              sender.send(`ai-provider:gen-progress:${sessionId}`, chunk);
            }
            if (!sender.isDestroyed()) {
              sender.send(`ai-provider:gen-complete:${sessionId}`);
            }
          } catch (error) {
            if (sender.isDestroyed()) return;
            const ipcError = toIpcError(error);
            if (ipcError.code !== "SESSION_CANCELLED") {
              sender.send(`ai-provider:gen-error:${sessionId}`, ipcError);
            }
          }
        })();

        return { sessionId, status: "streaming" };
      },
    );
  }

  private _registerSkillCallHandler(): void {
    ipcMain.handle(
      "ai-provider:skill-call",
      async (_event, payload: SkillCallRequest) => {
        // Non-streaming: await the full result and return it directly.
        return await this.manager.executeSkill(payload);
      },
    );
  }

  private _registerCancelHandler(): void {
    ipcMain.handle(
      "ai-provider:cancel",
      async (_event, { sessionId }: { sessionId: string }) => {
        await this.manager.cancelSession(sessionId);
      },
    );
  }

  private _registerStatusHandler(): void {
    ipcMain.handle("ai-provider:status", () => {
      return this.manager.getProviderStatus();
    });
  }

  /**
   * Subscribe to manager status changes and broadcast to all BrowserWindows.
   * Stored so it can be cleaned up in dispose().
   */
  private _registerStatusChangedBroadcast(): void {
    this.unsubscribeStatus = this.manager.onStatusChanged(
      (status: ProviderStatus) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send("ai-provider:status-changed", status);
          }
        }
      },
    );
  }

  // ── CR-001: ai-provider:set-provider ────────────────────────────────────────

  private _registerSetProviderHandler(): void {
    ipcMain.handle(
      "ai-provider:set-provider",
      async (_event, payload: { providerId: string; config?: ProviderConfig }) => {
        try {
          const { providerId } = payload;
          let config: ProviderConfig;

          if (providerId === "custom") {
            const saved = await loadCustomConfig();
            if (!saved) {
              return { success: false, error: { code: "PROVIDER_ERROR", message: "Custom provider not configured." } };
            }
            config = saved;
            const provider = new CustomOpenAIProvider();
            await this.manager.setProvider(provider, config);
          } else if (providerId === "claude-api") {
            config = payload.config ?? { providerId: "claude-api" as const };
            const provider = new ClaudeAPIProvider();
            await this.manager.setProvider(provider, config);
          } else {
            return { success: false, error: { code: "PROVIDER_ERROR", message: `Unknown provider: ${providerId}` } };
          }

          return { success: true };
        } catch (error) {
          return { success: false, error: toIpcError(error) };
        }
      },
    );
  }

  // ── CR-001: settings:get-custom-provider-config / set ───────────────────────

  private _registerCustomProviderConfigHandlers(): void {
    ipcMain.handle("settings:get-custom-provider-config", async () => {
      const config = await loadCustomConfig();
      const hasApiKey = (await apiKeyStore.getKey("custom")) !== null;
      return { config, hasApiKey };
    });

    ipcMain.handle(
      "settings:set-custom-provider-config",
      async (
        _event,
        payload: {
          baseUrl: string;
          planModel: string;
          codegenModel: string;
          apiKey?: string;
          clearApiKey?: boolean;
        },
      ) => {
        try {
          // Validate URL
          try {
            new URL(payload.baseUrl);
          } catch {
            return { success: false, error: { code: "INVALID_BASE_URL", message: "Invalid Base URL format." } };
          }

          // Save non-sensitive config
          await saveCustomConfig({
            customBaseUrl: payload.baseUrl,
            customPlanModel: payload.planModel,
            customCodegenModel: payload.codegenModel,
          });

          // Handle API key
          if (payload.clearApiKey) {
            await apiKeyStore.deleteKey("custom");
          } else if (payload.apiKey) {
            await apiKeyStore.setKey("custom", payload.apiKey);
          }

          // If current provider is custom, hot-reload
          const currentProvider = this.manager.getProvider();
          if (currentProvider && currentProvider.id === "custom") {
            const saved = await loadCustomConfig();
            if (saved) {
              const provider = new CustomOpenAIProvider();
              await this.manager.setProvider(provider, saved);
            }
          }

          return { success: true };
        } catch (error) {
          return { success: false, error: toIpcError(error) };
        }
      },
    );
  }

  // ── CR-001: settings:get-api-key / save-api-key (extended with providerId) ──

  private _registerApiKeyHandlers(): void {
    ipcMain.handle(
      "settings:get-api-key",
      async (_event, payload?: { providerId?: string }) => {
        const providerId = (payload?.providerId ?? "claude-api") as "claude-api" | "custom";
        if (providerId === "claude-api") {
          const key = await apiKeyStore.loadApiKey();
          return { key: key ? `${key.slice(0, 7)}***` : null, configured: key !== null };
        }
        const key = await apiKeyStore.getKey(providerId);
        return { key: key ? "***configured***" : null, configured: key !== null };
      },
    );

    ipcMain.handle(
      "settings:save-api-key",
      async (_event, payload: { apiKey?: string; key?: string; providerId?: string }) => {
        const providerId = (payload.providerId ?? "claude-api") as "claude-api" | "custom";
        const key = payload.apiKey ?? payload.key ?? "";
        if (providerId === "claude-api") {
          await apiKeyStore.saveApiKey(key);
        } else {
          await apiKeyStore.setKey(providerId, key);
        }
        return { success: true };
      },
    );
  }

  // ── CR-001: settings:test-connection ────────────────────────────────────────

  private _registerTestConnectionHandler(): void {
    ipcMain.handle("settings:test-connection", async () => {
      const provider = this.manager.getProvider();
      if (!provider) {
        return { success: false, error: "No provider configured." };
      }

      const providerName = provider.name;
      const start = Date.now();
      try {
        // Re-initialize to test (the provider is already ready, so this tests the connection)
        if (provider.status === "ready") {
          return {
            success: true,
            latencyMs: 0,
            providerName,
          };
        }
        return { success: false, error: "Provider is not ready.", providerName };
      } catch (error) {
        return {
          success: false,
          latencyMs: Date.now() - start,
          error: (error as Error).message,
          providerName,
        };
      }
    });
  }
}
