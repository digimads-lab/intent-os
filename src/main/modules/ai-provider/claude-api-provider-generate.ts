/**
 * M-04 AI Provider — generateCode implementation
 *
 * Implements the generateCode method for ClaudeAPIProvider using the standard
 * @anthropic-ai/sdk messages.create API with a manual tool-calling loop.
 *
 * This file exports a standalone async generator function that is bound to a
 * ClaudeAPIProvider instance via `generateCodeImpl.call(this, request)`.
 * It will be wired into ClaudeAPIProvider in claude-api-provider.ts.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { GenerateRequest, GenProgressChunk } from "./interfaces";
import { createBuildMCPServer } from "./build-mcp-server";
import type { BuildMCPServer } from "./build-mcp-server";
import type { PlanResult } from "./interfaces";
import type { ClaudeProviderConfig } from "@intentos/shared-types";

// ── Minimal shape of ClaudeAPIProvider that generateCodeImpl needs ─────────────

export interface GenerateCodeProviderCtx {
  anthropic: Anthropic;
  config: ClaudeProviderConfig;
  /** Map of sessionId → AbortController, managed by the provider */
  activeControllers: Map<string, AbortController>;
}

// ── System-prompt builder ──────────────────────────────────────────────────────

function buildGenerateSystemPrompt(plan: PlanResult): string {
  const moduleList = plan.modules
    .map((m) => `  - ${m.name} (${m.filePath}): ${m.description}`)
    .join("\n");

  const skillList = plan.skillUsage
    .map((s) => `  - skillId: ${s.skillId}, methods: [${s.methods.join(", ")}]`)
    .join("\n");

  return `You are an expert TypeScript + React developer generating a SkillApp for IntentOS.

## App to generate
Name: ${plan.appName}
Description: ${plan.description}

## Required modules
${moduleList}

## Skills used
${skillList}

## Technology constraints
- React 18 + TypeScript (strict mode)
- Electron renderer process (no Node.js APIs in renderer)
- Entry point must be src/main.tsx (renders into #root)
- Output directory structure:
    src/
      main.tsx        — app entry point
      App.tsx         — root React component
      components/     — reusable components
    package.json      — with "main": "dist/main.js", scripts: { build: "tsc" }
    tsconfig.json     — strict TypeScript config targeting ES2020

## Instructions
1. Write all source files using write_file.
2. After writing, run \`tsc --noEmit\` to validate types.
3. If tsc reports errors, fix them by rewriting the affected files.
4. Once tsc passes, run \`npm run build\` to produce the bundle.
5. Do not write any files outside the target directory.
6. Keep components small and focused. No unnecessary dependencies.`;
}

// ── Progress tracking ──────────────────────────────────────────────────────────

/**
 * Maps a tool_use block to a GenProgressChunk.
 * Progress is incremented per write_file call (up to 70%), then compile at 80%,
 * bundle at 90%, leaving 100% for the final "complete" chunk.
 */
function mapToolUseToProgress(
  block: Anthropic.Messages.ToolUseBlock,
  sessionId: string,
  fileIndex: number,
  totalEstimatedFiles: number
): GenProgressChunk {
  const input = block.input as Record<string, unknown>;

  if (block.name === "write_file") {
    const filePath = (input["path"] as string) ?? "unknown";
    // codegen progress: 5% base + up to 65% spread across files
    const perFileProgress = totalEstimatedFiles > 0 ? 65 / totalEstimatedFiles : 10;
    const progress = Math.min(5 + Math.round(fileIndex * perFileProgress), 70);
    return {
      sessionId,
      stage: "codegen",
      progress,
      message: `生成 ${filePath}`,
      filePath,
    };
  }

  if (block.name === "run_command") {
    const command = (input["command"] as string) ?? "";
    const args = (input["args"] as string[]) ?? [];
    const fullCmd = [command, ...args].join(" ");

    if (command === "tsc" || fullCmd.includes("tsc")) {
      return {
        sessionId,
        stage: "compile",
        progress: 80,
        message: "正在编译 TypeScript...",
      };
    }

    // npm run build / npx bundle / etc.
    return {
      sessionId,
      stage: "bundle",
      progress: 90,
      message: "正在打包...",
    };
  }

  // read_file or unknown — emit a codegen progress without incrementing
  return {
    sessionId,
    stage: "codegen",
    progress: Math.min(5 + Math.round(fileIndex * 10), 70),
    message: `执行工具: ${block.name}`,
  };
}

// ── Main implementation ────────────────────────────────────────────────────────

const DEFAULT_CODEGEN_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
// Estimated number of files in a typical SkillApp — used for progress scaling.
const ESTIMATED_FILE_COUNT = 8;

/**
 * generateCode implementation.
 *
 * Bind `this` to a ClaudeAPIProvider instance before calling:
 *   yield* generateCodeImpl.call(this, request)
 */
export async function* generateCodeImpl(
  this: GenerateCodeProviderCtx,
  request: GenerateRequest
): AsyncGenerator<GenProgressChunk> {
  const { sessionId, plan, targetDir } = request;
  const model = this.config.claudeCodegenModel ?? DEFAULT_CODEGEN_MODEL;

  // Create an AbortController so cancelSession() can abort this stream.
  const controller = new AbortController();
  this.activeControllers.set(sessionId, controller);

  const mcpServer: BuildMCPServer = createBuildMCPServer(targetDir);

  try {
    const systemPrompt = buildGenerateSystemPrompt(plan);
    const userMessage = `Generate the SkillApp as described. App ID: ${request.appId}. Plan details:\n${JSON.stringify(plan, null, 2)}`;

    // Conversation history; grows as we add assistant and tool_result turns.
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    // Map the MCP tools to the format @anthropic-ai/sdk expects.
    const tools: Anthropic.Messages.Tool[] = mcpServer.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Messages.Tool["input_schema"],
    }));

    let fileIndex = 0;

    // Tool-calling loop: keep calling the model until it signals end_turn.
    while (true) {
      // Abort check before each API call.
      if (controller.signal.aborted) {
        break;
      }

      const response = await this.anthropic.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          tools,
          messages,
        },
        { signal: controller.signal }
      );

      // Collect all tool_use blocks from this response turn.
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
      );

      // Yield progress for each tool call.
      for (const block of toolUseBlocks) {
        const chunk = mapToolUseToProgress(
          block,
          sessionId,
          fileIndex,
          ESTIMATED_FILE_COUNT
        );
        yield chunk;

        if (block.name === "write_file") {
          fileIndex++;
        }
      }

      // If there were tool calls, execute them and continue the loop.
      if (toolUseBlocks.length > 0) {
        // Add the assistant turn with the full content (including tool_use blocks).
        messages.push({ role: "assistant", content: response.content });

        // Execute each tool and collect results.
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          let resultContent: string;
          try {
            const result = await mcpServer.execute(
              block.name,
              block.input as Record<string, unknown>
            );
            resultContent = JSON.stringify(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            resultContent = JSON.stringify({ error: message });
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultContent,
          });
        }

        // Add tool results as a user turn.
        messages.push({ role: "user", content: toolResults });
      }

      // Stop when the model is done or there were no tool calls.
      if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        break;
      }
    }
  } finally {
    this.activeControllers.delete(sessionId);
    mcpServer.dispose();
  }

  // Final completion chunk.
  yield {
    sessionId,
    stage: "complete",
    progress: 100,
    message: "应用生成完成",
    entryPoint: "main.js",
    outputDir: targetDir,
  } as GenProgressChunk;
}
