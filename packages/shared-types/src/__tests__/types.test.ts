import { describe, it, expect } from "vitest";

import {
  AppMetaSchema,
  AppStatusSchema,
  AppRegistrationSchema,
  AppStatusChangedSchema,
} from "../app";
import {
  SkillMetaSchema,
  SkillManifestSchema,
  SkillStatusSchema,
  SkillRegistrationSchema,
} from "../skill";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validSkillMeta = () => ({
  id: "data-cleaner",
  name: "Data Cleaner",
  version: "1.0.0",
  description: "A skill that cleans data",
  author: "IntentOS",
  capabilities: ["clean", "transform"],
  dependencies: [],
  entryPoint: "dist/index.js",
  manifestPath: "manifest.json",
});

const validAppMeta = () => ({
  id: "app-abc123",
  name: "CSV Cleaner",
  skillIds: ["data-cleaner"],
  intent: "Clean my CSV files",
  createdAt: "2026-03-13T00:00:00.000Z",
  updatedAt: "2026-03-13T00:00:00.000Z",
  version: 1,
  outputDir: "/apps/csv-cleaner/dist",
  entryPoint: "/apps/csv-cleaner/dist/main.js",
});

// ─── SkillMetaSchema ──────────────────────────────────────────────────────────

describe("SkillMetaSchema", () => {
  it("accepts a valid SkillMeta object", () => {
    const result = SkillMetaSchema.safeParse(validSkillMeta());
    expect(result.success).toBe(true);
  });

  it("rejects when id is missing", () => {
    const { id: _id, ...rest } = validSkillMeta();
    const result = SkillMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when name is missing", () => {
    const { name: _name, ...rest } = validSkillMeta();
    const result = SkillMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when version is missing", () => {
    const { version: _version, ...rest } = validSkillMeta();
    const result = SkillMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts capabilities as an empty array", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), capabilities: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when version is not a semver string", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), version: "v1" });
    expect(result.success).toBe(false);
  });

  it("rejects when version is a number instead of a string", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), version: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects an id with uppercase characters", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), id: "DataCleaner" });
    expect(result.success).toBe(false);
  });

  it("rejects an id with spaces", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), id: "data cleaner" });
    expect(result.success).toBe(false);
  });

  it("accepts an id with only digits and hyphens", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), id: "skill-01" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = SkillMetaSchema.safeParse({ ...validSkillMeta(), name: "" });
    expect(result.success).toBe(false);
  });
});

// ─── SkillManifestSchema ──────────────────────────────────────────────────────

describe("SkillManifestSchema", () => {
  it("accepts a valid SkillManifest object", () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkillMeta(),
      skillImplementation: "src/skill.ts",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when skillImplementation is missing", () => {
    const result = SkillManifestSchema.safeParse(validSkillMeta());
    expect(result.success).toBe(false);
  });

  it("rejects when skillImplementation is an empty string", () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkillMeta(),
      skillImplementation: "",
    });
    expect(result.success).toBe(false);
  });
});

// ─── SkillStatusSchema ────────────────────────────────────────────────────────

describe("SkillStatusSchema", () => {
  it("accepts 'active'", () => {
    expect(SkillStatusSchema.safeParse("active").success).toBe(true);
  });

  it("accepts 'inactive'", () => {
    expect(SkillStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("accepts 'error'", () => {
    expect(SkillStatusSchema.safeParse("error").success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    expect(SkillStatusSchema.safeParse("pending").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(SkillStatusSchema.safeParse("").success).toBe(false);
  });
});

// ─── SkillRegistrationSchema ──────────────────────────────────────────────────

describe("SkillRegistrationSchema", () => {
  it("accepts a valid SkillRegistration object", () => {
    const result = SkillRegistrationSchema.safeParse({
      ...validSkillMeta(),
      status: "active",
      registeredAt: "2026-03-13T00:00:00.000Z",
      directoryPath: "/skills/data-cleaner",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when status is missing", () => {
    const result = SkillRegistrationSchema.safeParse({
      ...validSkillMeta(),
      registeredAt: "2026-03-13T00:00:00.000Z",
      directoryPath: "/skills/data-cleaner",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when registeredAt is not an ISO datetime", () => {
    const result = SkillRegistrationSchema.safeParse({
      ...validSkillMeta(),
      status: "active",
      registeredAt: "2026-03-13",
      directoryPath: "/skills/data-cleaner",
    });
    expect(result.success).toBe(false);
  });
});

// ─── AppStatusSchema ──────────────────────────────────────────────────────────

describe("AppStatusSchema", () => {
  const validStatuses = ["stopped", "starting", "running", "crashed", "updating"] as const;

  validStatuses.forEach((status) => {
    it(`accepts '${status}'`, () => {
      expect(AppStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it("rejects an unknown status value", () => {
    expect(AppStatusSchema.safeParse("idle").success).toBe(false);
  });

  it("rejects 'uninstalled' which is not in the enum", () => {
    expect(AppStatusSchema.safeParse("uninstalled").success).toBe(false);
  });
});

// ─── AppMetaSchema ────────────────────────────────────────────────────────────

describe("AppMetaSchema", () => {
  it("accepts a valid AppMeta object", () => {
    const result = AppMetaSchema.safeParse(validAppMeta());
    expect(result.success).toBe(true);
  });

  it("accepts skillIds as an empty array", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), skillIds: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when outputDir is missing", () => {
    const { outputDir: _outputDir, ...rest } = validAppMeta();
    const result = AppMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when id is missing", () => {
    const { id: _id, ...rest } = validAppMeta();
    const result = AppMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when intent is missing", () => {
    const { intent: _intent, ...rest } = validAppMeta();
    const result = AppMetaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when intent is an empty string", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), intent: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when version is less than 1", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), version: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer version", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), version: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when createdAt is not a valid ISO datetime", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), createdAt: "2026-03-13" });
    expect(result.success).toBe(false);
  });

  it("rejects when updatedAt is not a valid ISO datetime", () => {
    const result = AppMetaSchema.safeParse({ ...validAppMeta(), updatedAt: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

// ─── AppRegistrationSchema ────────────────────────────────────────────────────

describe("AppRegistrationSchema", () => {
  const validRegistration = () => ({
    ...validAppMeta(),
    status: "stopped" as const,
    crashCount: 0,
  });

  it("accepts a valid AppRegistration object", () => {
    const result = AppRegistrationSchema.safeParse(validRegistration());
    expect(result.success).toBe(true);
  });

  it("accepts optional pid when running", () => {
    const result = AppRegistrationSchema.safeParse({
      ...validRegistration(),
      status: "running",
      pid: 12345,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional windowId when running", () => {
    const result = AppRegistrationSchema.safeParse({
      ...validRegistration(),
      status: "running",
      windowId: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when status is missing", () => {
    const { status: _status, ...rest } = validRegistration();
    const result = AppRegistrationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when crashCount is missing", () => {
    const { crashCount: _crashCount, ...rest } = validRegistration();
    const result = AppRegistrationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a negative crashCount", () => {
    const result = AppRegistrationSchema.safeParse({ ...validRegistration(), crashCount: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive pid", () => {
    const result = AppRegistrationSchema.safeParse({
      ...validRegistration(),
      pid: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ─── AppStatusChangedSchema ───────────────────────────────────────────────────

describe("AppStatusChangedSchema", () => {
  it("accepts a valid AppStatusChanged event without pid", () => {
    const result = AppStatusChangedSchema.safeParse({
      appId: "app-abc123",
      status: "running",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid AppStatusChanged event with pid", () => {
    const result = AppStatusChangedSchema.safeParse({
      appId: "app-abc123",
      status: "running",
      pid: 9999,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when appId is missing", () => {
    const result = AppStatusChangedSchema.safeParse({ status: "running" });
    expect(result.success).toBe(false);
  });

  it("rejects when appId is an empty string", () => {
    const result = AppStatusChangedSchema.safeParse({ appId: "", status: "running" });
    expect(result.success).toBe(false);
  });

  it("rejects when status is an invalid value", () => {
    const result = AppStatusChangedSchema.safeParse({
      appId: "app-abc123",
      status: "unknown",
    });
    expect(result.success).toBe(false);
  });
});
