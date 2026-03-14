/**
 * M-04 AI Provider — BuildMCPServer
 *
 * Provides a lightweight in-process MCP-style tool server for the code-generation
 * Agent.  Three tools are exposed: write_file, read_file, and run_command.
 *
 * All file-system operations are sandboxed to the configured targetDir.
 * run_command is restricted to a known-safe allowlist (tsc, node, npm/npx).
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

// ── Public interface types ─────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

export interface BuildMCPServer {
  tools: MCPTool[];
  execute(toolName: string, params: Record<string, unknown>): Promise<unknown>;
  setTargetDir(dir: string): void;
  dispose(): void;
}

// ── Allowlisted commands ───────────────────────────────────────────────────────

const ALLOWED_COMMANDS = new Set(["tsc", "node", "npm", "npx"]);

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: "write_file",
    description:
      "Write content to a file inside the target directory. " +
      "The path must be relative and must not escape the target directory.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the target directory",
        },
        content: {
          type: "string",
          description: "Text content to write",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the content of a file inside the target directory. " +
      "The path must be relative and must not escape the target directory.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the target directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a build command inside the target directory. " +
      "Allowed commands: tsc, node, npm, npx. " +
      "Returns stdout, stderr, and the exit code.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The executable to run (must be one of: tsc, node, npm, npx)",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional argument list",
        },
      },
      required: ["command"],
    },
  },
];

// ── Internal result types ──────────────────────────────────────────────────────

interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── BuildMCPServerImpl ─────────────────────────────────────────────────────────

class BuildMCPServerImpl implements BuildMCPServer {
  private targetDir: string;

  constructor(initialTargetDir: string) {
    this.targetDir = initialTargetDir;
  }

  get tools(): MCPTool[] {
    return TOOL_DEFINITIONS;
  }

  setTargetDir(dir: string): void {
    this.targetDir = dir;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case "write_file":
        return this._writeFile(params);
      case "read_file":
        return this._readFile(params);
      case "run_command":
        return this._runCommand(params);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  dispose(): void {
    // Nothing to clean up for the in-process implementation.
  }

  // ── Tool implementations ───────────────────────────────────────────────────

  private _resolveSafe(relativePath: string): string {
    // Normalise so ".." sequences are resolved before the prefix check.
    const resolved = path.resolve(this.targetDir, relativePath);
    const targetPrefix = path.resolve(this.targetDir) + path.sep;

    // Allow exact match (root of targetDir) or prefix match (files inside it).
    if (resolved !== path.resolve(this.targetDir) && !resolved.startsWith(targetPrefix)) {
      throw new Error(
        `Path "${relativePath}" resolves outside the target directory. ` +
          `Access denied.`
      );
    }
    return resolved;
  }

  private async _writeFile(params: Record<string, unknown>): Promise<{ written: boolean; path: string }> {
    const relativePath = params["path"] as string;
    const content = params["content"] as string;

    if (typeof relativePath !== "string" || typeof content !== "string") {
      throw new Error("write_file requires string params: path, content");
    }

    const absolute = this._resolveSafe(relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");

    return { written: true, path: relativePath };
  }

  private async _readFile(params: Record<string, unknown>): Promise<{ content: string }> {
    const relativePath = params["path"] as string;

    if (typeof relativePath !== "string") {
      throw new Error("read_file requires string param: path");
    }

    const absolute = this._resolveSafe(relativePath);
    const content = fs.readFileSync(absolute, "utf8");
    return { content };
  }

  private async _runCommand(params: Record<string, unknown>): Promise<RunCommandResult> {
    const command = params["command"] as string;
    const args = Array.isArray(params["args"]) ? (params["args"] as string[]) : [];

    if (typeof command !== "string") {
      throw new Error("run_command requires string param: command");
    }

    // Security: only allow known-safe commands.
    const baseCommand = path.basename(command);
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      throw new Error(
        `Command "${baseCommand}" is not allowed. ` +
          `Permitted commands: ${[...ALLOWED_COMMANDS].join(", ")}.`
      );
    }

    return new Promise<RunCommandResult>((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(command, args, {
        cwd: this.targetDir,
        shell: false,
        env: { ...process.env },
      });

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      child.on("error", (err) => {
        resolve({
          stdout,
          stderr: stderr + "\n" + err.message,
          exitCode: 1,
        });
      });
    });
  }
}

// ── Factory function ───────────────────────────────────────────────────────────

/**
 * Create a new BuildMCPServer sandbox rooted at `targetDir`.
 */
export function createBuildMCPServer(targetDir: string): BuildMCPServer {
  return new BuildMCPServerImpl(targetDir);
}
