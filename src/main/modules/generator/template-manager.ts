/**
 * CR-002: TemplateManager
 *
 * Reads and caches SkillApp template files so they can be injected
 * into the code generation prompt, guiding the AI to produce code
 * that follows the standard SkillApp structure.
 */

import fs from "fs";
import path from "path";

// ── TemplateManager ──────────────────────────────────────────────────────────

export class TemplateManager {
  private templateGuide: string = "";
  private templateExamples: string = "";
  private initialized: boolean = false;

  /**
   * Read template files from the skillapp-template directory and cache them.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const templateDir = path.resolve(__dirname, "../../src/skillapp-template");

    // Read the template guide if it exists
    const guidePath = path.join(templateDir, "TEMPLATE_GUIDE.md");
    try {
      this.templateGuide = await fs.promises.readFile(guidePath, "utf8");
    } catch {
      // Guide file doesn't exist yet — use a sensible default
      this.templateGuide = this.getDefaultGuide();
    }

    // Read key template files as examples
    this.templateExamples = await this.readExampleFiles(templateDir);
    this.initialized = true;
  }

  /**
   * Get the template guide content (TEMPLATE_GUIDE.md or default).
   */
  getTemplateGuide(): string {
    return this.templateGuide;
  }

  /**
   * Get concatenated example template file contents.
   */
  getTemplateExamples(): string {
    return this.templateExamples;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async readExampleFiles(templateDir: string): Promise<string> {
    const exampleFiles = [
      "package.json.template",
      "main.js.template",
      "preload.js.template",
    ];

    const sections: string[] = [];

    for (const file of exampleFiles) {
      const filePath = path.join(templateDir, file);
      try {
        const content = await fs.promises.readFile(filePath, "utf8");
        sections.push(`// === ${file} ===\n${content}`);
      } catch {
        // Template file not found — skip
      }
    }

    // Also try to read src/ subdirectory templates
    const srcDir = path.join(templateDir, "src");
    try {
      const srcFiles = await this.walkDir(srcDir);
      for (const filePath of srcFiles) {
        if (
          filePath.endsWith(".template") ||
          filePath.endsWith(".tsx") ||
          filePath.endsWith(".ts")
        ) {
          const relPath = path.relative(templateDir, filePath);
          const content = await fs.promises.readFile(filePath, "utf8");
          sections.push(`// === ${relPath} ===\n${content}`);
        }
      }
    } catch {
      // src directory doesn't exist — skip
    }

    return sections.join("\n\n");
  }

  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await this.walkDir(fullPath)));
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return results;
  }

  private getDefaultGuide(): string {
    return `# SkillApp 代码结构指南

## 目录结构
生成的 SkillApp 必须遵循以下目录结构：

\`\`\`
{appDir}/
├── package.json          # 应用元数据和依赖
├── main.js               # Electron 主进程入口
├── preload.js            # preload 脚本（contextBridge）
└── src/
    ├── App.tsx            # React 根组件
    ├── router.tsx         # React Router 路由配置
    ├── pages/             # 页面组件目录
    │   └── {PageName}.tsx
    ├── components/        # 共享组件目录
    │   └── {ComponentName}.tsx
    └── styles/
        └── global.css     # 全局样式
\`\`\`

## 技术要求
- 使用 React 18 + TypeScript
- 使用 Tailwind CSS 进行样式设计
- 主进程必须设置 contextIsolation: true, nodeIntegration: false, sandbox: true
- 渲染进程只能通过 window.intentOS API 访问系统功能

## 测试模式支持
main.js 必须支持 INTENTOS_TEST_MODE 环境变量：
- 当 INTENTOS_TEST_MODE=1 时，创建隐藏窗口
- 页面加载完成后输出 "INTENTOS_READY" 到 stdout
- 5 秒后自动退出
`;
  }
}
