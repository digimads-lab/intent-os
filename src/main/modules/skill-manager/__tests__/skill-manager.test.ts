/**
 * Unit tests for SkillManager (M-02)
 *
 * Strategy:
 * - Uses an in-memory SQLite database (:memory:) passed directly to the
 *   SkillManager constructor, so no Electron userData path is needed.
 * - Spies on `fs.accessSync` and `fs.readFileSync` (the synchronous methods
 *   used by readSkillManifest / validateManifest) rather than replacing the
 *   entire module, which avoids ESM default-export mock wiring issues.
 * - electron mock is present so db.ts can be imported without crashing
 *   (db.ts calls app.getPath at module load time).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'

// ── Electron mock ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
}))

// Import under test AFTER mocks are declared so electron mock is active
import { SkillManager, SkillManagerError } from '../skill-manager'

// ── In-memory database factory ────────────────────────────────────────────────

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      description TEXT DEFAULT '',
      author TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '[]',
      entryPoint TEXT NOT NULL,
      manifestPath TEXT NOT NULL,
      directoryPath TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      registeredAt TEXT NOT NULL,

      CHECK (
        id IS NOT NULL AND
        name IS NOT NULL AND
        version IS NOT NULL AND
        entryPoint IS NOT NULL AND
        directoryPath IS NOT NULL
      )
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_version ON skills(version);

    CREATE TABLE IF NOT EXISTS skill_app_refs (
      skillId TEXT NOT NULL,
      appId TEXT NOT NULL,
      appName TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (skillId, appId),
      FOREIGN KEY (skillId) REFERENCES skills(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skill_app_refs_skillId ON skill_app_refs(skillId);
    CREATE INDEX IF NOT EXISTS idx_skill_app_refs_appId ON skill_app_refs(appId);
  `)
  return db
}

// ── Mock skill.json manifest content ─────────────────────────────────────────

const MOCK_MANIFEST = {
  name: 'test-skill',
  version: '1.0.0',
  description: 'Used for testing',
  author: 'Test',
  capabilities: ['test.run'],
  dependencies: [],
  entryPoint: 'src/index.ts',
}

const TEST_DIR = '/fake/skills/test-skill'
const SKILL_ID = 'test-skill@1.0.0'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SkillManager', () => {
  let db: Database.Database
  let manager: SkillManager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accessSyncSpy: MockInstance<any[], any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let readFileSyncSpy: MockInstance<any[], any>

  // Configure spies to simulate a readable directory + valid manifest
  function setupValidSkillFs(manifestJson: string = JSON.stringify(MOCK_MANIFEST)): void {
    accessSyncSpy.mockImplementation(() => undefined)
    readFileSyncSpy.mockImplementation((filePath: unknown) => {
      if (typeof filePath === 'string' && filePath.endsWith('skill.json')) {
        return manifestJson
      }
      return ''
    })
  }

  beforeEach(() => {
    db = createInMemoryDb()
    manager = new SkillManager(db)

    // Spy on the real fs methods so we can control them per-test
    accessSyncSpy = vi.spyOn(fs, 'accessSync')
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── getInstalledSkills ──────────────────────────────────────────────────────

  describe('getInstalledSkills', () => {
    it('returns empty array when no skills are registered', () => {
      const skills = manager.getInstalledSkills()
      expect(skills).toEqual([])
    })

    it('returns registered skills with correct fields after registration', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)

      const skills = manager.getInstalledSkills()

      expect(skills).toHaveLength(1)
      const skill = skills[0]
      expect(skill.id).toBe(SKILL_ID)
      expect(skill.name).toBe('test-skill')
      expect(skill.version).toBe('1.0.0')
      expect(skill.description).toBe('Used for testing')
      expect(skill.author).toBe('Test')
      expect(skill.capabilities).toEqual(['test.run'])
      expect(skill.dependencies).toEqual([])
      expect(skill.entryPoint).toBe('src/index.ts')
      expect(skill.directoryPath).toBe(TEST_DIR)
      expect(skill.status).toBe('active')
      expect(typeof skill.registeredAt).toBe('string')
    })
  })

  // ── registerSkill idempotency ────────────────────────────────────────────────

  describe('registerSkill — idempotency', () => {
    it('returns a SkillRegistration on first registration', () => {
      setupValidSkillFs()
      const result = manager.registerSkill(TEST_DIR)

      expect(result.id).toBe(SKILL_ID)
      expect(result.name).toBe('test-skill')
      expect(result.version).toBe('1.0.0')
      expect(result.directoryPath).toBe(TEST_DIR)
    })

    it('returns the same record when the same directoryPath is registered twice', () => {
      setupValidSkillFs()
      const first = manager.registerSkill(TEST_DIR)
      const second = manager.registerSkill(TEST_DIR)

      expect(second.id).toBe(first.id)
      expect(second.name).toBe(first.name)
      expect(second.version).toBe(first.version)
    })

    it('does not insert a duplicate row when called twice with the same path', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
      manager.registerSkill(TEST_DIR)

      expect(manager.getInstalledSkills()).toHaveLength(1)
    })

    it('throws SKILL_ALREADY_REGISTERED when the same name+version is registered from a different directory', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)

      // Same manifest name+version, different directory — spy still active
      const differentDir = '/fake/skills/other-dir'
      let caughtError: SkillManagerError | undefined
      try {
        manager.registerSkill(differentDir)
      } catch (e) {
        caughtError = e as SkillManagerError
      }

      expect(caughtError).toBeInstanceOf(SkillManagerError)
      expect(caughtError?.code).toBe('SKILL_ALREADY_REGISTERED')
    })
  })

  // ── unregisterSkill — reference-count protection ─────────────────────────────

  describe('unregisterSkill — reference-count protection', () => {
    beforeEach(() => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
    })

    it('successfully unregisters a skill that has no app references', () => {
      expect(() => manager.unregisterSkill(SKILL_ID)).not.toThrow()
    })

    it('returns null from getSkillById after a successful unregister', () => {
      manager.unregisterSkill(SKILL_ID)
      expect(manager.getSkillById(SKILL_ID)).toBeNull()
    })

    it('throws SKILL_HAS_REFERENCES when the skill is referenced by one app', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App Alpha')

      let caughtCode: string | undefined
      try {
        manager.unregisterSkill(SKILL_ID)
      } catch (e) {
        caughtCode = (e as SkillManagerError).code
      }

      expect(caughtCode).toBe('SKILL_HAS_REFERENCES')
    })

    it('includes the referencing app name in the error message', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App Alpha')

      let errorMessage = ''
      try {
        manager.unregisterSkill(SKILL_ID)
      } catch (e) {
        errorMessage = (e as SkillManagerError).message
      }

      expect(errorMessage).toContain('App Alpha')
    })

    it('includes all referencing app names in the error message when multiple apps reference the skill', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App Alpha')
      manager.addAppRef(SKILL_ID, 'app-002', 'App Beta')

      let errorMessage = ''
      try {
        manager.unregisterSkill(SKILL_ID)
      } catch (e) {
        errorMessage = (e as SkillManagerError).message
      }

      expect(errorMessage).toContain('App Alpha')
      expect(errorMessage).toContain('App Beta')
    })

    it('allows unregister after all app references have been removed', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App Alpha')
      manager.removeAppRef(SKILL_ID, 'app-001')

      expect(() => manager.unregisterSkill(SKILL_ID)).not.toThrow()
      expect(manager.getSkillById(SKILL_ID)).toBeNull()
    })

    it('throws SKILL_NOT_FOUND when unregistering a skill that does not exist', () => {
      let caughtCode: string | undefined
      try {
        manager.unregisterSkill('nonexistent@1.0.0')
      } catch (e) {
        caughtCode = (e as SkillManagerError).code
      }

      expect(caughtCode).toBe('SKILL_NOT_FOUND')
    })
  })

  // ── checkDependencies ────────────────────────────────────────────────────────

  describe('checkDependencies', () => {
    beforeEach(() => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
    })

    it('returns hasApps: false and empty appNames when no app references exist', () => {
      const result = manager.checkDependencies(SKILL_ID)
      expect(result.hasApps).toBe(false)
      expect(result.appNames).toEqual([])
    })

    it('returns hasApps: true and the app name when one app references the skill', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App A')

      const result = manager.checkDependencies(SKILL_ID)
      expect(result.hasApps).toBe(true)
      expect(result.appNames).toContain('App A')
    })

    it('returns all referencing app names when multiple apps reference the skill', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App A')
      manager.addAppRef(SKILL_ID, 'app-002', 'App B')

      const result = manager.checkDependencies(SKILL_ID)
      expect(result.hasApps).toBe(true)
      expect(result.appNames).toHaveLength(2)
      expect(result.appNames).toContain('App A')
      expect(result.appNames).toContain('App B')
    })

    it('returns hasApps: false after all references are removed', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App A')
      manager.removeAppRef(SKILL_ID, 'app-001')

      const result = manager.checkDependencies(SKILL_ID)
      expect(result.hasApps).toBe(false)
      expect(result.appNames).toEqual([])
    })
  })

  // ── SQLite transaction — rollback on manifest read failure ───────────────────

  describe('SQLite transactions — rollback on failure', () => {
    it('leaves the database unchanged when skill.json cannot be read', () => {
      // Directory accessible, but readFileSync throws
      accessSyncSpy.mockImplementation(() => undefined)
      readFileSyncSpy.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory')
      })

      expect(() => manager.registerSkill(TEST_DIR)).toThrow(SkillManagerError)
      expect(manager.getInstalledSkills()).toHaveLength(0)
    })

    it('leaves the database unchanged when the directory is not accessible', () => {
      accessSyncSpy.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      expect(() => manager.registerSkill(TEST_DIR)).toThrow(SkillManagerError)
      expect(manager.getInstalledSkills()).toHaveLength(0)
    })

    it('leaves the database unchanged when skill.json contains invalid JSON', () => {
      accessSyncSpy.mockImplementation(() => undefined)
      readFileSyncSpy.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.endsWith('skill.json')) {
          return '{ this is not valid JSON }'
        }
        return ''
      })

      expect(() => manager.registerSkill(TEST_DIR)).toThrow(SkillManagerError)
      expect(manager.getInstalledSkills()).toHaveLength(0)
    })

    it('leaves the database unchanged when skill.json fails manifest validation (missing name)', () => {
      const badManifest = JSON.stringify({
        version: '1.0.0',
        entryPoint: 'src/index.ts',
        // name field intentionally omitted
      })
      accessSyncSpy.mockImplementation(() => undefined)
      readFileSyncSpy.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.endsWith('skill.json')) {
          return badManifest
        }
        return ''
      })

      expect(() => manager.registerSkill(TEST_DIR)).toThrow(SkillManagerError)
      expect(manager.getInstalledSkills()).toHaveLength(0)
    })
  })

  // ── Persistence — skill list restored after re-instantiation ─────────────────

  describe('persistence — skill list survives re-instantiation', () => {
    it('getInstalledSkills returns the registered skill when a new SkillManager is created with the same db', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)

      // Simulate a "restart": new SkillManager instance, same underlying db
      const newManager = new SkillManager(db)
      const skills = newManager.getInstalledSkills()

      expect(skills).toHaveLength(1)
      expect(skills[0].id).toBe(SKILL_ID)
      expect(skills[0].name).toBe('test-skill')
      expect(skills[0].version).toBe('1.0.0')
    })

    it('getSkillById returns null in the new instance for a skill unregistered before restart', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
      manager.unregisterSkill(SKILL_ID)

      const newManager = new SkillManager(db)
      expect(newManager.getSkillById(SKILL_ID)).toBeNull()
    })

    it('preserves app references across re-instantiation', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
      manager.addAppRef(SKILL_ID, 'app-001', 'App Alpha')

      const newManager = new SkillManager(db)
      const deps = newManager.checkDependencies(SKILL_ID)

      expect(deps.hasApps).toBe(true)
      expect(deps.appNames).toContain('App Alpha')
    })
  })

  // ── getSkillById ──────────────────────────────────────────────────────────────

  describe('getSkillById', () => {
    it('returns null when the skill does not exist', () => {
      expect(manager.getSkillById('nonexistent@1.0.0')).toBeNull()
    })

    it('returns the SkillRegistration when the skill exists', () => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)

      const result = manager.getSkillById(SKILL_ID)
      expect(result).not.toBeNull()
      expect(result!.id).toBe(SKILL_ID)
    })
  })

  // ── addAppRef / removeAppRef ──────────────────────────────────────────────────

  describe('addAppRef', () => {
    beforeEach(() => {
      setupValidSkillFs()
      manager.registerSkill(TEST_DIR)
    })

    it('throws SKILL_NOT_FOUND when adding a reference to a non-existent skill', () => {
      let caughtCode: string | undefined
      try {
        manager.addAppRef('nonexistent@1.0.0', 'app-001', 'App A')
      } catch (e) {
        caughtCode = (e as SkillManagerError).code
      }

      expect(caughtCode).toBe('SKILL_NOT_FOUND')
    })

    it('does not throw when adding the same app reference twice (INSERT OR IGNORE)', () => {
      manager.addAppRef(SKILL_ID, 'app-001', 'App A')
      expect(() => manager.addAppRef(SKILL_ID, 'app-001', 'App A')).not.toThrow()
    })
  })
})
