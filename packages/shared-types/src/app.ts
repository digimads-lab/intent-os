import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const AppStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "crashed",
  "updating",
]);

export const AppMetaSchema = z.object({
  /** Application unique identifier */
  id: z.string().min(1),
  /** Display name */
  name: z.string().min(1),
  /** List of skill IDs used by this app */
  skillIds: z.array(z.string()),
  /** Natural-language intent that generated this app */
  intent: z.string().min(1),
  /** ISO 8601 creation timestamp */
  createdAt: z.string().datetime(),
  /** ISO 8601 last-modified timestamp */
  updatedAt: z.string().datetime(),
  /** Incrementing version number */
  version: z.number().int().min(1),
  /** Directory where compiled output is stored */
  outputDir: z.string().min(1),
  /** Electron main-process entry file */
  entryPoint: z.string().min(1),
});

export const AppRegistrationSchema = AppMetaSchema.extend({
  status: AppStatusSchema,
  /** OS process ID (present while running) */
  pid: z.number().int().positive().optional(),
  /** Electron window ID (present while running) */
  windowId: z.number().int().nonnegative().optional(),
  /** Number of times this app has crashed */
  crashCount: z.number().int().nonnegative(),
});

export const AppStatusChangedSchema = z.object({
  appId: z.string().min(1),
  status: AppStatusSchema,
  pid: z.number().int().positive().optional(),
});

// ── TypeScript Types (inferred from Zod schemas) ──────────────────────────────

export type AppStatus = z.infer<typeof AppStatusSchema>;
export type AppMeta = z.infer<typeof AppMetaSchema>;
export type AppRegistration = z.infer<typeof AppRegistrationSchema>;
export type AppStatusChanged = z.infer<typeof AppStatusChangedSchema>;
