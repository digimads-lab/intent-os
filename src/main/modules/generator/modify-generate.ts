/**
 * M-05 SkillApp 生成器 — 增量代码生成执行器
 *
 * 职责：
 * - 只对 ModifyPlan.added 和 ModifyPlan.modified 中的模块调用 AI Provider 重新生成
 * - unchanged 模块绝不触发任何 AI Provider 调用（核心优化）
 * - 组装 HotUpdatePackage，调用 M-06 hotUpdater.applyHotUpdate()
 * - 通过 IPC 向渲染进程上报进度（modification:progress channel）
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

import type { WebContents } from "electron";

import type { AIProvider } from "../ai-provider/interfaces";
import type { LifecycleManager } from "../lifecycle-manager/lifecycle-manager";
import type { HotUpdater, HotUpdatePackage } from "../hot-updater/index";
import type { ModifySessionManager } from "./modify-session";
import { GeneratorError } from "./types";
import type { ModifyPlan, ModuleChange } from "./types";

// ── 进度事件类型 ───────────────────────────────────────────────────────────────

/** 发送给渲染进程的进度事件格式（与 ModificationProgress in modification-store.ts 一致） */
interface ModificationProgress {
  sessionId: string;
  stage: "backup" | "codegen" | "compile" | "push" | "done";
  status: "active" | "done" | "error";
  message?: string;
}

// ── 公开 API ───────────────────────────────────────────────────────────────────

/**
 * 用户确认增量修改方案后，执行增量代码生成并热更新。
 *
 * 采用 fire-and-forget 模式运行：IPC handler 立即返回，实际工作在后台进行。
 * 错误通过 IPC 通知渲染进程，由 hotUpdater 负责回滚。
 *
 * @param sessionId          修改会话 ID
 * @param appId              目标 SkillApp 的 appId
 * @param sender             发起请求的渲染进程 WebContents（精确 IPC 路由）
 * @param modifySessionMgr   ModifySessionManager 实例
 * @param aiProvider         M-04 AI Provider 实例
 * @param lifecycleMgr       M-03 LifecycleManager 实例（用于解析 appDir）
 * @param hotUpdaterInstance M-06 HotUpdater 实例
 */
export async function confirmAndApplyModify(
  sessionId: string,
  appId: string,
  sender: WebContents | null,
  modifySessionMgr: ModifySessionManager,
  aiProvider: AIProvider,
  lifecycleMgr: LifecycleManager,
  hotUpdaterInstance: HotUpdater,
): Promise<void> {
  // Fire-and-forget: IPC handler 可立即返回，不阻塞
  _runModifyGenerate(
    sessionId,
    appId,
    sender,
    modifySessionMgr,
    aiProvider,
    lifecycleMgr,
    hotUpdaterInstance,
  ).catch((err) => {
    if (sender && !sender.isDestroyed()) {
      sender.send(`modification:error:${sessionId}`, {
        sessionId,
        code: err instanceof GeneratorError ? err.code : "MODIFY_GENERATE_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// ── 内部实现 ───────────────────────────────────────────────────────────────────

/**
 * 实际增量生成执行流程。
 */
async function _runModifyGenerate(
  sessionId: string,
  appId: string,
  sender: WebContents | null,
  modifySessionMgr: ModifySessionManager,
  aiProvider: AIProvider,
  lifecycleMgr: LifecycleManager,
  hotUpdaterInstance: HotUpdater,
): Promise<void> {
  // 1. 获取 ModifyPlan
  const plan = modifySessionMgr.getModifySession(sessionId);
  if (!plan) {
    throw new GeneratorError("MODIFY_SESSION_WRONG_STATE", {
      sessionId,
      reason: "ModifyPlan not available — planning may still be in progress",
    });
  }

  // 2. 解析 appDir（从 lifecycleManager 的 app 注册表中获取 outputDir）
  const apps = await lifecycleMgr.listApps();
  const appMeta = apps.find((a) => a.id === appId);
  if (!appMeta) {
    throw new GeneratorError("APP_DIR_NOT_FOUND", { appId });
  }
  const appDir = appMeta.outputDir;

  // 3. 读取当前版本号（用于构造 HotUpdatePackage）
  const fromVersion = await readAppVersion(appDir);
  const toVersion = bumpPatchVersion(fromVersion);

  // 4. 只对 added + modified 模块调用 AI Provider（unchanged 绝不触发）
  const changedModules = [...plan.added, ...plan.modified];

  for (const module of changedModules) {

    // 上报进度：codegen 阶段 active（附带当前模块名）
    sendProgress(sender, {
      sessionId,
      stage: "codegen",
      status: "active",
      message: module.filePath,
    });

    // 调用 AI Provider 生成单个模块的代码
    const content = await generateSingleModule(
      sessionId,
      appId,
      appDir,
      module,
      aiProvider,
    );

    // 将生成内容写回 module（供后续构造 UpdatePackage 使用）
    module.content = content;
  }

  // 所有模块生成完毕，codegen done
  sendProgress(sender, { sessionId, stage: "codegen", status: "done" });

  // 5. 上报编译进度 active
  sendProgress(sender, { sessionId, stage: "compile", status: "active" });

  // 6. 构造 HotUpdatePackage
  const updatePackage = buildHotUpdatePackage(appId, fromVersion, toVersion, plan);

  // 7. 上报推送进度 active
  sendProgress(sender, { sessionId, stage: "push", status: "active" });

  // 8. 调用 M-06 applyHotUpdate()（内含备份、编译、推送、等待 ack 全流程）
  await hotUpdaterInstance.applyHotUpdate(appId, updatePackage, appDir);

  // 9. 上报完成
  sendProgress(sender, { sessionId, stage: "done", status: "done" });

  if (sender && !sender.isDestroyed()) {
    sender.send("modification:complete", {
      sessionId,
      appId,
      modulesChanged: changedModules.length,
      modulesUnchanged: plan.unchanged.length,
    });
  }
}

/**
 * 调用 AI Provider 生成单个模块的代码内容。
 *
 * 消费 GenProgressChunk 流，返回生成文件的文本内容。
 * unchanged 模块绝不经过此函数——此处只处理 added/modified 模块。
 *
 * @returns 生成的文件内容（UTF-8 文本）
 */
async function generateSingleModule(
  sessionId: string,
  appId: string,
  appDir: string,
  module: ModuleChange,
  aiProvider: AIProvider,
): Promise<string> {
  // 构造单模块 PlanResult（AI Provider generateCode 需要此结构）
  const singleModulePlan = {
    appName: appId,
    description: module.description,
    modules: [
      {
        name: path.basename(module.filePath, path.extname(module.filePath)),
        filePath: module.filePath,
        description: module.description,
      },
    ],
    skillUsage: [],
  };

  const stream = aiProvider.generateCode({
    sessionId,
    plan: singleModulePlan,
    appId,
    targetDir: appDir,
  });

  // 消费流 — 生成结果最终写入磁盘由 AI Provider 处理（targetDir 传入）
  // 此处我们消费流以确保生成完成，并尝试读取生成后的文件内容
  for await (const _chunk of stream) {
    // 流消费完毕即生成完成；进度已在上层按模块索引上报
  }

  // 读取 AI Provider 写入磁盘的生成文件内容
  const filePath = path.join(appDir, module.filePath);
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return content;
  } catch {
    // 若文件未生成（AI Provider 未写入），返回空字符串，后续 HotUpdater 会校验
    return "";
  }
}

/**
 * 构造 HotUpdatePackage。
 *
 * - plan.modified → modules[].action = 'modify'
 * - plan.added    → modules[].action = 'add'
 * - plan.unchanged → 不出现在 modules 中
 * - 内容以 base64 编码（HotUpdatePackage 协议要求）
 */
function buildHotUpdatePackage(
  appId: string,
  fromVersion: string,
  toVersion: string,
  plan: ModifyPlan,
): HotUpdatePackage {
  const modules = [
    ...plan.modified.map((m) => ({
      path: m.filePath,
      action: "modify" as const,
      content: Buffer.from(m.content ?? "").toString("base64"),
    })),
    ...plan.added.map((m) => ({
      path: m.filePath,
      action: "add" as const,
      content: Buffer.from(m.content ?? "").toString("base64"),
    })),
  ];

  const checksumPayload = JSON.stringify({ appId, fromVersion, toVersion, modules });
  const checksum = crypto
    .createHash("sha256")
    .update(checksumPayload)
    .digest("hex");

  return {
    appId,
    fromVersion,
    toVersion,
    timestamp: Date.now(),
    modules,
    manifest: {},
    checksum,
  };
}

// ── 辅助函数 ───────────────────────────────────────────────────────────────────

/**
 * 向渲染进程发送 modification:progress 事件。
 */
function sendProgress(
  sender: WebContents | null,
  progress: ModificationProgress,
): void {
  if (sender && !sender.isDestroyed()) {
    sender.send(`modification:progress:${progress.sessionId}`, progress);
  }
}

/**
 * 读取 SkillApp manifest.json 中的版本号。
 * 若读取失败或无版本字段，返回默认值 "1.0.0"。
 */
async function readAppVersion(appDir: string): Promise<string> {
  try {
    const manifestPath = path.join(appDir, "manifest.json");
    const raw = await fs.promises.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { version?: string | number };
    const v = manifest.version;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return `${v}.0.0`;
    return "1.0.0";
  } catch {
    return "1.0.0";
  }
}

/**
 * 对版本号的 patch 段加一（1.0.0 → 1.0.1）。
 * 若版本格式不符合 semver，在版本号后附加 ".1"。
 */
function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length === 3) {
    const patch = parseInt(parts[2], 10);
    if (!isNaN(patch)) {
      return `${parts[0]}.${parts[1]}.${patch + 1}`;
    }
  }
  return `${version}.1`;
}
