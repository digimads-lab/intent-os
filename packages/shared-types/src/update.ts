import { z } from "zod";

import { AppMetaSchema } from "./app.js";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const UpdatePackageSchema = z.object({
  /** ID of the app being updated */
  appId: z.string().min(1),
  /** Version being updated from */
  fromVersion: z.string().min(1),
  /** Version being updated to */
  toVersion: z.string().min(1),
  /** Unix timestamp (ms) when the package was created */
  timestamp: z.number().int().positive(),
  /** Relative paths of files with changed content */
  changedFiles: z.array(z.string()),
  /** Relative paths of newly added files */
  addedFiles: z.array(z.string()),
  /** Relative paths of deleted files */
  deletedFiles: z.array(z.string()),
  /** Partial AppMeta fields that changed in this update */
  manifestDelta: AppMetaSchema.partial().optional(),
  /** SHA-256 checksum of the whole package */
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  /** Human-readable description of what changed */
  description: z.string().min(1),
});

// ── TypeScript Types (inferred from Zod schemas) ──────────────────────────────

export type UpdatePackage = z.infer<typeof UpdatePackageSchema>;
