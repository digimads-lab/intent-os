/**
 * M-02 Skill Manager — core implementation
 */

import type Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import type { SkillRegistration } from '@intentos/shared-types'
import type { SkillRecord } from './types'

// ── Simple YAML frontmatter parser ────────────────────────────────────────────
//
// Supports a limited YAML subset sufficient for skill.md:
//   - String scalars (with or without surrounding quotes)
//   - Inline empty list: key: []
//   - Block lists:
//       key:
//         - item1
//         - item2
//   - Comments (#) and blank lines are ignored
// Does NOT support nested objects, booleans, numbers, or multi-line strings.

function parseSkillMarkdown(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    throw new Error('No valid YAML frontmatter found')
  }
  const yaml = match[1]
  const result: Record<string, unknown> = {}
  const lines = yaml.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      i++
      continue
    }
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    // Strip surrounding single or double quotes from scalar values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Inline empty list
    if (value === '[]') {
      result[key] = []
      i++
      continue
    }

    // Empty value — look ahead for block list items
    if (value === '') {
      const listItems: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s+-\s*/.test(lines[j])) {
        listItems.push(lines[j].replace(/^\s+-\s*/, '').trim())
        j++
      }
      if (listItems.length > 0) {
        result[key] = listItems
        i = j
        continue
      }
      result[key] = null
      i++
      continue
    }

    result[key] = value
    i++
  }
  return result
}

// ── Skill manifest as read from skill.md ──────────────────────────────────────

interface SkillManifestFile {
  id?: string
  name: string
  version: string
  description?: string
  author?: string
  capabilities?: string[]
  dependencies?: string[]
  entryPoint: string
}

// ── DB row returned by better-sqlite3 ─────────────────────────────────────────

interface SkillRow extends SkillRecord {}

interface AppRefRow {
  skillId: string
  appId: string
  appName: string
  createdAt: number
}

// ── Error class ───────────────────────────────────────────────────────────────

export class SkillManagerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'SkillManagerError'
  }
}

// ── SkillManager ──────────────────────────────────────────────────────────────

export class SkillManager {
  private readonly insertSkill: Database.Statement
  private readonly updateSkill: Database.Statement
  private readonly selectSkillById: Database.Statement
  private readonly selectSkillByName: Database.Statement
  private readonly selectAllSkills: Database.Statement
  private readonly deleteSkillById: Database.Statement
  private readonly selectRefsBySkillId: Database.Statement
  private readonly insertRef: Database.Statement
  private readonly deleteRef: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertSkill = db.prepare(`
      INSERT INTO skills
        (id, name, version, description, author, capabilities, dependencies,
         entryPoint, manifestPath, directoryPath, status, registeredAt)
      VALUES
        (@id, @name, @version, @description, @author, @capabilities, @dependencies,
         @entryPoint, @manifestPath, @directoryPath, @status, @registeredAt)
    `)

    this.updateSkill = db.prepare(`
      UPDATE skills SET
        description = @description,
        author = @author,
        capabilities = @capabilities,
        dependencies = @dependencies,
        entryPoint = @entryPoint,
        manifestPath = @manifestPath,
        status = @status
      WHERE id = @id
    `)

    this.selectSkillById = db.prepare('SELECT * FROM skills WHERE id = ?')
    this.selectSkillByName = db.prepare('SELECT * FROM skills WHERE name = ?')
    this.selectAllSkills = db.prepare('SELECT * FROM skills ORDER BY registeredAt DESC')
    this.deleteSkillById = db.prepare('DELETE FROM skills WHERE id = ?')

    this.selectRefsBySkillId = db.prepare(
      'SELECT * FROM skill_app_refs WHERE skillId = ?'
    )
    this.insertRef = db.prepare(`
      INSERT OR IGNORE INTO skill_app_refs (skillId, appId, appName, createdAt)
      VALUES (@skillId, @appId, @appName, @createdAt)
    `)
    this.deleteRef = db.prepare(
      'DELETE FROM skill_app_refs WHERE skillId = ? AND appId = ?'
    )
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Register a skill from a local directory.
   * Idempotent: if the same directoryPath is already registered, returns the
   * existing record (updating metadata when the manifest has changed).
   */
  registerSkill(directoryPath: string): SkillRegistration {
    const meta = this.readSkillManifest(directoryPath)
    const skillId = `${meta.name}@${meta.version}`
    const manifestPath = path.join(directoryPath, 'skill.md')

    // Check for existing record by ID (same name+version)
    const existing = this.selectSkillById.get(skillId) as SkillRow | undefined

    if (existing) {
      // Same skillId: check if directoryPath matches
      if (existing.directoryPath !== directoryPath) {
        throw new SkillManagerError(
          'SKILL_ALREADY_REGISTERED',
          `Skill "${skillId}" is already registered from a different directory: ${existing.directoryPath}`,
        )
      }
      // Idempotent: update in case manifest content changed
      const updateTxn = this.db.transaction(() => {
        this.updateSkill.run({
          id: skillId,
          description: meta.description ?? '',
          author: meta.author ?? '',
          capabilities: JSON.stringify(meta.capabilities ?? []),
          dependencies: JSON.stringify(meta.dependencies ?? []),
          entryPoint: meta.entryPoint,
          manifestPath,
          status: 'active',
        })
      })
      updateTxn()
      return this.rowToRegistration(
        this.selectSkillById.get(skillId) as SkillRow
      )
    }

    // Check if a skill with the same name but different version is registered
    const sameNameRow = this.selectSkillByName.get(meta.name) as SkillRow | undefined
    if (sameNameRow) {
      throw new SkillManagerError(
        'SKILL_ALREADY_REGISTERED',
        `Skill "${meta.name}" is already registered with version ${sameNameRow.version}. Unregister it first.`,
      )
    }

    // Insert in a transaction
    const insertTxn = this.db.transaction(() => {
      this.insertSkill.run({
        id: skillId,
        name: meta.name,
        version: meta.version,
        description: meta.description ?? '',
        author: meta.author ?? '',
        capabilities: JSON.stringify(meta.capabilities ?? []),
        dependencies: JSON.stringify(meta.dependencies ?? []),
        entryPoint: meta.entryPoint,
        manifestPath,
        directoryPath,
        status: 'active',
        registeredAt: new Date().toISOString(),
      })
    })
    insertTxn()

    return this.rowToRegistration(
      this.selectSkillById.get(skillId) as SkillRow
    )
  }

  /**
   * Unregister (remove) a skill.
   * Throws if the skill has active app references.
   */
  unregisterSkill(skillId: string): void {
    const skill = this.selectSkillById.get(skillId) as SkillRow | undefined
    if (!skill) {
      throw new SkillManagerError(
        'SKILL_NOT_FOUND',
        `Skill "${skillId}" not found`,
      )
    }

    const refs = this.selectRefsBySkillId.all(skillId) as AppRefRow[]
    if (refs.length > 0) {
      const appNames = refs.map(r => r.appName)
      throw new SkillManagerError(
        'SKILL_HAS_REFERENCES',
        `Cannot unregister skill "${skillId}": it is referenced by apps: ${appNames.join(', ')}`,
      )
    }

    const deleteTxn = this.db.transaction(() => {
      this.deleteSkillById.run(skillId)
    })
    deleteTxn()
  }

  /** Return all installed skills. */
  getInstalledSkills(): SkillRegistration[] {
    const rows = this.selectAllSkills.all() as SkillRow[]
    return rows.map(row => this.rowToRegistration(row))
  }

  /** Return a single skill by ID, or null if not found. */
  getSkillById(skillId: string): SkillRegistration | null {
    const row = this.selectSkillById.get(skillId) as SkillRow | undefined
    return row ? this.rowToRegistration(row) : null
  }

  /** Check which apps reference this skill. */
  checkDependencies(skillId: string): { hasApps: boolean; appNames: string[] } {
    const refs = this.selectRefsBySkillId.all(skillId) as AppRefRow[]
    return {
      hasApps: refs.length > 0,
      appNames: refs.map(r => r.appName),
    }
  }

  /** Register an app's reference to a skill (called by M-03 after app creation). */
  addAppRef(skillId: string, appId: string, appName: string): void {
    const skill = this.selectSkillById.get(skillId) as SkillRow | undefined
    if (!skill) {
      throw new SkillManagerError(
        'SKILL_NOT_FOUND',
        `Skill "${skillId}" not found`,
      )
    }
    this.insertRef.run({
      skillId,
      appId,
      appName,
      createdAt: Date.now(),
    })
  }

  /** Remove an app's reference to a skill (called by M-03 after app removal). */
  removeAppRef(skillId: string, appId: string): void {
    this.deleteRef.run(skillId, appId)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private readSkillManifest(directoryPath: string): SkillManifestFile {
    try {
      fs.accessSync(directoryPath, fs.constants.R_OK)
    } catch {
      throw new SkillManagerError(
        'IO_ERROR',
        `Directory not accessible: ${directoryPath}`,
      )
    }

    const manifestPath = path.join(directoryPath, 'skill.md')
    let manifestContent: string
    try {
      manifestContent = fs.readFileSync(manifestPath, 'utf-8')
    } catch (err) {
      throw new SkillManagerError(
        'IO_ERROR',
        `Cannot read skill.md at ${manifestPath}`,
        err,
      )
    }

    let manifest: unknown
    try {
      manifest = parseSkillMarkdown(manifestContent)
    } catch (err) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        `Invalid frontmatter in skill.md at ${manifestPath}`,
        err,
      )
    }

    return this.validateManifest(manifest, directoryPath)
  }

  private validateManifest(raw: unknown, directoryPath: string): SkillManifestFile {
    if (typeof raw !== 'object' || raw === null) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        'skill.md frontmatter must be an object',
      )
    }

    const obj = raw as Record<string, unknown>

    if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        'skill.md missing required field: name',
      )
    }

    if (typeof obj['version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj['version'])) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        `skill.md field "version" must be semver (major.minor.patch), got: ${String(obj['version'])}`,
      )
    }

    if (typeof obj['entryPoint'] !== 'string' || obj['entryPoint'].length === 0) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        'skill.md missing required field: entryPoint',
      )
    }

    const namePattern = /^[a-z0-9\-_]+$/
    if (!namePattern.test(obj['name'])) {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        `skill.md field "name" must match pattern [a-z0-9\\-_], got: ${obj['name']}`,
      )
    }

    // Verify entryPoint file exists
    const entryPointPath = path.join(directoryPath, obj['entryPoint'])
    try {
      fs.accessSync(entryPointPath, fs.constants.R_OK)
    } catch {
      throw new SkillManagerError(
        'INVALID_SKILL_MANIFEST',
        `entryPoint file not found: ${entryPointPath}`,
      )
    }

    const result: SkillManifestFile = {
      name: obj['name'],
      version: obj['version'],
      entryPoint: obj['entryPoint'],
      capabilities: Array.isArray(obj['capabilities'])
        ? (obj['capabilities'] as string[]).filter(c => typeof c === 'string')
        : [],
      dependencies: Array.isArray(obj['dependencies'])
        ? (obj['dependencies'] as string[]).filter(d => typeof d === 'string')
        : [],
    }
    if (typeof obj['description'] === 'string') result.description = obj['description']
    if (typeof obj['author'] === 'string') result.author = obj['author']
    return result
  }

  private rowToRegistration(row: SkillRow): SkillRegistration {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description,
      author: row.author,
      capabilities: JSON.parse(row.capabilities) as string[],
      dependencies: JSON.parse(row.dependencies) as string[],
      entryPoint: row.entryPoint,
      manifestPath: row.manifestPath,
      directoryPath: row.directoryPath,
      status: row.status,
      registeredAt: row.registeredAt,
    }
  }
}
