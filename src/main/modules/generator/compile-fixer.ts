/**
 * M-05 SkillApp 生成器 — 编译错误自动修复器
 *
 * 职责：
 * - 捕获 tsc 编译错误，格式化为结构化的 CompileError[]
 * - 构造修复 prompt，通过 M-04 AI Provider 调用 Claude 修复代码
 * - 最多重试 3 次，超过限制后返回结构化的失败结果（含所有编译错误详情）
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import type { AIProvider, PlanRequest } from "../ai-provider/interfaces";
import type { CompileError, CompileFixResult } from "./types";

// ── CompileFixer ──────────────────────────────────────────────────────────────

/**
 * 编译错误自动修复器
 *
 * 对给定的 SkillApp 目录执行最多 3 次 AI 辅助修复循环，
 * 每次循环：格式化错误 → 读取出错文件 → 构造 prompt → 调用 AI → 写回 → 重新编译。
 */
export class CompileFixer {
  private static readonly MAX_RETRIES = 3;

  // ── 公开 API ────────────────────────────────────────────────────────────────

  /**
   * 尝试修复编译错误，最多重试 3 次。
   *
   * @param appDir  SkillApp 根目录（targetDir）
   * @param errors  当前编译错误列表
   * @param provider M-04 AI Provider 实例（已初始化）
   * @returns 修复结果（成功或失败，含剩余错误）
   */
  async tryFix(
    appDir: string,
    errors: CompileError[],
    provider: AIProvider,
  ): Promise<CompileFixResult> {
    const MAX_RETRIES = CompileFixer.MAX_RETRIES;
    let currentErrors = errors;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // 1. 格式化错误信息为 tsc 标准格式
      const errorText = this.formatErrors(currentErrors);

      // 2. 读取出错文件的当前内容
      const fileContents = await this.readErrorFiles(appDir, currentErrors);

      // 3. 构造修复 prompt
      const fixPrompt = this.buildFixPrompt(errorText, fileContents);

      // 4. 调用 M-04 AI Provider（使用 planApp 的流式接口进行单轮修复）
      const fixedFiles = await this.requestFix(provider, fixPrompt, appDir);

      // 5. 将修复后的文件写回磁盘
      await this.writeFixedFiles(appDir, fixedFiles);

      // 6. 重新执行 tsc 编译
      const compileResult = await this.runTsc(appDir);

      if (compileResult.success) {
        return { success: true, attempts: attempt };
      }

      currentErrors = compileResult.errors;

      // 第 3 次失败后不再重试，直接返回
      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          attempts: MAX_RETRIES,
          finalErrors: currentErrors,
        };
      }
    }

    // 不应到达此处，但 TypeScript 要求明确返回
    return { success: false, attempts: MAX_RETRIES, finalErrors: currentErrors };
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────────

  /**
   * 将 CompileError[] 格式化为 tsc 标准错误格式：
   * {file}({line},{column}): error {code}: {message}
   */
  private formatErrors(errors: CompileError[]): string {
    return errors
      .map(
        (e) => `${e.file}(${e.line},${e.column}): error ${e.code}: ${e.message}`,
      )
      .join("\n");
  }

  /**
   * 读取出错文件的当前内容。
   * 对 errors 中的 file 路径去重，逐一读取并返回映射。
   */
  private async readErrorFiles(
    appDir: string,
    errors: CompileError[],
  ): Promise<Record<string, string>> {
    const uniqueFiles = [...new Set(errors.map((e) => e.file))];
    const result: Record<string, string> = {};

    for (const file of uniqueFiles) {
      try {
        result[file] = await fs.promises.readFile(
          path.join(appDir, file),
          "utf-8",
        );
      } catch {
        // 文件不存在或无法读取时跳过，不中断修复流程
        result[file] = "";
      }
    }

    return result;
  }

  /**
   * 构造发送给 AI Provider 的修复 prompt。
   */
  private buildFixPrompt(
    errorText: string,
    fileContents: Record<string, string>,
  ): string {
    const fileSection = Object.entries(fileContents)
      .map(
        ([filePath, content]) =>
          `// FILE: ${filePath}\n${content}`,
      )
      .join("\n\n");

    return `以下 TypeScript 代码存在编译错误，请修复。

编译错误：
${errorText}

出错文件内容：
${fileSection}

请直接返回修复后的完整文件内容，格式如下：
// FILE: {filePath}
{修复后内容}`;
  }

  /**
   * 调用 AI Provider 获取修复后的文件内容。
   * 使用 planApp 流式接口进行单轮对话，累积 assistant 内容后解析文件分隔符。
   */
  private async requestFix(
    provider: AIProvider,
    prompt: string,
    _appDir: string,
  ): Promise<Record<string, string>> {
    const request: PlanRequest = {
      sessionId: `fix-${Date.now()}`,
      intent: prompt,
      skills: [],
      contextHistory: [],
    };

    const stream = provider.planApp(request);

    let accumulated = "";
    for await (const chunk of stream) {
      if (chunk.content) {
        accumulated += chunk.content;
      }
    }

    return this.parseFixedFiles(accumulated);
  }

  /**
   * 解析 AI 返回内容，按 `// FILE: {path}` 分隔符提取各文件内容。
   */
  private parseFixedFiles(responseText: string): Record<string, string> {
    const result: Record<string, string> = {};
    // 匹配 // FILE: {path} 分隔行，提取文件路径和后续内容
    const filePattern = /^\/\/ FILE:\s+(.+)$/gm;
    const matches = [...responseText.matchAll(filePattern)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const filePath = match[1].trim();
      const startIndex = (match.index ?? 0) + match[0].length + 1; // +1 for newline
      const endIndex =
        i + 1 < matches.length ? matches[i + 1].index ?? responseText.length : responseText.length;
      const content = responseText.slice(startIndex, endIndex).trimEnd();
      result[filePath] = content;
    }

    return result;
  }

  /**
   * 将修复后的文件内容写回磁盘。
   */
  private async writeFixedFiles(
    appDir: string,
    files: Record<string, string>,
  ): Promise<void> {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(appDir, filePath);
      // 确保父目录存在
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content, "utf-8");
    }
  }

  /**
   * 在 appDir 中执行 `npx tsc --noEmit`，解析输出并返回编译结果。
   * 使用 spawn 避免命令行长度限制。
   */
  private runTsc(
    appDir: string,
  ): Promise<{ success: boolean; errors: CompileError[] }> {
    return new Promise((resolve) => {
      const proc = spawn("npx", ["tsc", "--noEmit"], {
        cwd: appDir,
        shell: false,
      });

      let output = "";

      proc.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.on("close", (exitCode: number | null) => {
        const success = exitCode === 0;
        const errors = success ? [] : this.parseTscOutput(output);
        resolve({ success, errors });
      });

      proc.on("error", () => {
        // spawn 本身失败（如 npx 不可用）——视为编译失败，无错误详情
        resolve({ success: false, errors: [] });
      });
    });
  }

  /**
   * 解析 tsc 的标准错误输出，提取结构化的 CompileError 列表。
   * 匹配格式：{file}({line},{column}): error {code}: {message}
   */
  private parseTscOutput(output: string): CompileError[] {
    const pattern =
      /^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
    const errors: CompileError[] = [];

    for (const match of output.matchAll(pattern)) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[4],
        message: match[5].trim(),
      });
    }

    return errors;
  }
}
