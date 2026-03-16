/**
 * CR-002: M-05a MockPreviewGenerator
 *
 * Generates an HTML mock preview of the planned SkillApp UI.
 * The mock is displayed in an iframe on the renderer side so users
 * can review and refine before committing to full code generation.
 *
 * Uses streamText (not planApp) so that the AI receives a UI-design
 * system prompt instead of the planning system prompt.
 */

import type { WebContents } from "electron";

import type { PlanResult, SkillMeta } from "@intentos/shared-types";
import type { StreamTextChunk } from "../ai-provider/interfaces";

import { GeneratorError } from "./types";

// ── Narrow AI interface ──────────────────────────────────────────────────────

interface MockStreamCapable {
  streamText(request: {
    sessionId: string;
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): AsyncIterable<StreamTextChunk>;
}

// ── Internal state ───────────────────────────────────────────────────────────

interface MockSession {
  sessionId: string;
  planResult: PlanResult;
  skills: SkillMeta[];
  mockHtml: string;
  mockHistory: Array<{ role: "user" | "assistant"; content: string }>;
  approved: boolean;
  sender: WebContents | null;
}

// ── MockPreviewGenerator ─────────────────────────────────────────────────────

export class MockPreviewGenerator {
  private readonly sessions: Map<string, MockSession> = new Map();

  constructor(private readonly aiProvider: MockStreamCapable) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Generate an HTML mock preview for a confirmed plan.
   * Streams partial HTML via IPC `generation:mock-html:{sessionId}`.
   */
  async requestMockPreview(
    sessionId: string,
    planResult: PlanResult,
    skills: SkillMeta[],
    sender: WebContents | null,
  ): Promise<void> {
    const session: MockSession = {
      sessionId,
      planResult,
      skills,
      mockHtml: "",
      mockHistory: [],
      approved: false,
      sender,
    };
    this.sessions.set(sessionId, session);

    const userMessage = buildMockUserMessage(planResult, skills);
    session.mockHistory.push({ role: "user", content: userMessage });

    await this.streamMock(session);
  }

  /**
   * Revise the mock based on user feedback.
   */
  async reviseMock(sessionId: string, feedback: string): Promise<void> {
    const session = this.getSession(sessionId);

    const revisedMessage = `请根据以下反馈修改界面 Mock：\n${feedback}`;
    session.mockHistory.push({ role: "user", content: revisedMessage });
    session.mockHtml = "";

    await this.streamMock(session);
  }

  /**
   * Mark the mock as approved so the pipeline can proceed.
   */
  approveMock(sessionId: string): void {
    const session = this.getSession(sessionId);
    session.approved = true;
  }

  /**
   * Check whether the mock has been approved.
   */
  isMockApproved(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.approved ?? false;
  }

  /**
   * Clean up a mock session.
   */
  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getSession(sessionId: string): MockSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new GeneratorError("MOCK_SESSION_NOT_FOUND", { sessionId });
    }
    return session;
  }

  private async streamMock(session: MockSession): Promise<void> {
    const stream = this.aiProvider.streamText({
      sessionId: `mock-${session.sessionId}`,
      systemPrompt: MOCK_SYSTEM_PROMPT,
      messages: session.mockHistory,
    });

    let accumulated = "";
    for await (const chunk of stream) {
      accumulated += chunk.content;

      const sender = session.sender;
      if (sender && !sender.isDestroyed()) {
        sender.send(`generation:mock-html:${session.sessionId}`, {
          html: sanitizeMockHtml(extractHtml(accumulated)),
          isPartial: !chunk.done,
        });
      }
    }

    const finalHtml = extractHtml(accumulated);
    session.mockHtml = sanitizeMockHtml(finalHtml);
    session.mockHistory.push({ role: "assistant", content: accumulated });
  }
}

// ── System prompt for mock generation ─────────────────────────────────────────

const MOCK_SYSTEM_PROMPT = `你是一个专业的 UI 设计师。你的任务是根据用户提供的应用设计方案，生成一个完整的 HTML 界面线框图预览页面。

## 输出要求
1. 输出一个完整的 HTML 文件（以 <!DOCTYPE html> 开头），包含内联 CSS
2. 使用现代 UI 风格：深色主题（背景 #1a1a2e 或类似深色），圆角卡片，柔和阴影
3. 页面布局：左侧 sidebar 导航 + 顶部 header + 右侧内容区
4. 根据功能模块生成对应的 UI 元素：按钮、表单输入框、数据表格、图表占位符、列表等
5. 每个模块/页面用 tab 或 sidebar 切换展示
6. 界面文字和标签使用中文
7. 不包含任何 JavaScript（纯静态 HTML + CSS）
8. 不包含任何外部资源链接（不使用 CDN、外部图片等）
9. 颜色搭配要协调美观，使用渐变和半透明效果增加层次感
10. 直接输出 HTML 代码，不要包含任何解释文字或 markdown 代码块标记`;

// ── User message builder ──────────────────────────────────────────────────────

function buildMockUserMessage(planResult: PlanResult, skills: SkillMeta[]): string {
  const modulesList = planResult.modules
    .map((m) => `- ${m.name}: ${m.description}`)
    .join("\n");

  const skillsList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");

  return `请根据以下应用设计方案，生成 HTML 界面预览。

## 应用信息
- 应用名称：${planResult.appName}
- 描述：${planResult.description}

## 页面/模块列表
${modulesList || "（暂无模块信息）"}

## 使用的 Skill
${skillsList || "（暂无 Skill 信息）"}

请直接输出完整的 HTML 代码。`;
}

// ── HTML extraction from AI response ──────────────────────────────────────────

/**
 * Extract pure HTML from an AI response that may contain markdown code blocks.
 * If the response contains ```html ... ```, extract the HTML content.
 * Otherwise, return the response as-is (it should already be HTML).
 */
function extractHtml(text: string): string {
  // Try to extract from markdown code block: ```html ... ```
  const codeBlockMatch = text.match(/```html\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try generic code block: ``` ... ```
  const genericMatch = text.match(/```\s*\n?([\s\S]*?)```/);
  if (genericMatch && genericMatch[1].trim().startsWith("<!")) {
    return genericMatch[1].trim();
  }

  // No code block — return as-is (may be partial during streaming)
  return text;
}

// ── HTML sanitisation ────────────────────────────────────────────────────────

/**
 * Strip dangerous content from AI-generated HTML before sending to the
 * renderer iframe (which uses `sandbox="allow-same-origin"`).
 */
function sanitizeMockHtml(html: string): string {
  let safe = html;

  // 1. Remove <script> tags and their contents
  safe = safe.replace(/<script[\s\S]*?<\/script>/gi, "");

  // 2. Remove event handler attributes
  safe = safe.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 3. Remove external resource URLs (src/href pointing to http/https)
  safe = safe.replace(
    /\s+(src|href)\s*=\s*(?:"https?:\/\/[^"]*"|'https?:\/\/[^']*')/gi,
    "",
  );

  // 4. Inject a CSP meta tag right after <head> (or at the very start)
  const cspTag =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">';
  if (safe.includes("<head>")) {
    safe = safe.replace("<head>", `<head>${cspTag}`);
  } else {
    safe = cspTag + safe;
  }

  return safe;
}

export { sanitizeMockHtml };
