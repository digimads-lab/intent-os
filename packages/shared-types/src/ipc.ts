import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const IPCResultSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const IPCResultFailureSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
  code: z.string().optional(),
});

export const ConnectionStatusSchema = z.enum([
  "connected",
  "disconnected",
  "reconnecting",
]);

// ── TypeScript Types ──────────────────────────────────────────────────────────

/** Generic IPC result discriminated union */
export type IPCResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
