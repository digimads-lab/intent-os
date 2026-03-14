/**
 * M-02 Skill Manager — internal types (extends shared-types)
 */

export interface SkillRecord {
  id: string
  name: string
  version: string
  description: string
  author: string
  capabilities: string  // JSON string of string[]
  dependencies: string  // JSON string of string[]
  entryPoint: string
  manifestPath: string
  directoryPath: string
  status: 'active' | 'inactive' | 'error'
  registeredAt: string  // ISO datetime
}
