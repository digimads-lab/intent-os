import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const SkillMetaSchema = z.object({
  /** Skill unique identifier, e.g. 'data-cleaner' */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Display name */
  name: z.string().min(1),
  /** Semver version string */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Short description */
  description: z.string().min(1),
  /** Author name or organisation */
  author: z.string().min(1),
  /** List of capability strings exposed by this skill */
  capabilities: z.array(z.string()),
  /** IDs of other skills this skill depends on */
  dependencies: z.array(z.string()),
  /** Path to the skill entry module */
  entryPoint: z.string().min(1),
  /** Path to the skill manifest file */
  manifestPath: z.string().min(1),
});

export const SkillManifestSchema = SkillMetaSchema.extend({
  /** Path to the skill implementation file */
  skillImplementation: z.string().min(1),
});

export const SkillStatusSchema = z.enum(["active", "inactive", "error"]);

export const SkillRegistrationSchema = SkillMetaSchema.extend({
  status: SkillStatusSchema,
  registeredAt: z.string().datetime(),
  directoryPath: z.string().min(1),
});

// ── TypeScript Types (inferred from Zod schemas) ──────────────────────────────

export type SkillMeta = z.infer<typeof SkillMetaSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type SkillStatus = z.infer<typeof SkillStatusSchema>;
export type SkillRegistration = z.infer<typeof SkillRegistrationSchema>;
