/**
 * Protocol Enforcement Plugin for opencode
 *
 * Enforces cross-cutting protocols at phase transitions:
 * - Artifact handling (gitignore, .gitattributes)
 * - Pre-commit behavior
 * - Session file locks
 * - Cross-team requirements
 * - Library selection
 * - Spec lifecycle / DRIFT
 *
 * Phase transitions are detected via phase-detect.ts, which parses
 * assistant message text for [PHASE: X] headers. opencode session
 * metadata does not carry phase information.
 */

import { getCurrentPhase, updatePhaseFromMessages } from './phase-detect'
import { exists, readFile } from 'node:fs/promises'

interface ProtocolState {
  sessionId: string
  currentPhase: string
  specVersion: string | null
  hasSpec: boolean
  editedFiles: string[]
  protocolsChecked: Set<string>
}

const protocolStates = new Map<string, ProtocolState>()

const PHASE_TRANSITIONS = {
  REVIEW: [
    'artifact-handling',
    'pre-commit',
    'locks',
    'api-design',
    'code-decision-ladder',
    'library-first',
  ],
  PLAN: ['review-complete', 'locks', 'cross-team', 'library-selection'],
  PATCH: ['plan-approved', 'rewrite-contract', 'locks', 'code-decision-ladder', 'library-first'],
  DRIFT: ['spec-exists'],
  CHECKLIST: ['discovery', 'artifact-handling'],
}

const PROTOCOL_CHECKS = {
  'artifact-handling': async (_directory: string, _editedFiles: string[], _state: any) => {
    const checks = []
    const gitignorePath = '.gitignore'
    const hasGitignore = await exists(gitignorePath)
    if (!hasGitignore) {
      checks.push({ protocol: 'artifact-handling', passed: false, message: '.gitignore missing' })
    } else {
      const content = await readFile(gitignorePath, 'utf-8')
      const required = ['.session-locks/', '.playwright-mcp/']
      for (const req of required) {
        if (!content.includes(req)) {
          checks.push({
            protocol: 'artifact-handling',
            passed: false,
            message: `gitignore missing: ${req}`,
          })
        }
      }
    }
    const gitattributesPath = '.gitattributes'
    const hasGitattributes = await exists(gitattributesPath)
    if (!hasGitattributes) {
      checks.push({
        protocol: 'gitattributes',
        passed: false,
        message: '.gitattributes missing (recommend: * text=auto eol=lf)',
      })
    }
    return checks
  },

  'pre-commit': async (_directory: string, _editedFiles: string[], _state: any) => {
    const checks = []
    const precommitPath = '.pre-commit-config.yaml'
    const huskyPath = '.husky/pre-commit'
    const hasPrecommit = await exists(precommitPath)
    const hasHusky = await exists(huskyPath)
    if (!hasPrecommit && !hasHusky) {
      checks.push({
        protocol: 'pre-commit',
        passed: false,
        message: 'No pre-commit hooks configured (pre-commit or husky)',
      })
    } else {
      if (hasPrecommit) {
        const content = await readFile(precommitPath, 'utf-8')
        const required = ['formatter', 'linter', 'secret']
        for (const req of required) {
          if (!content.toLowerCase().includes(req)) {
            checks.push({
              protocol: 'pre-commit',
              passed: false,
              message: `Pre-commit may lack ${req} hook`,
            })
          }
        }
      }
    }
    return checks
  },

  locks: async (_directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    const lockDir = '.session-locks'
    const hasLockDir = await exists(lockDir)
    if (!hasLockDir && editedFiles.length > 0) {
      checks.push({
        protocol: 'locks',
        passed: false,
        message: 'No .session-locks directory but files were edited',
      })
    }
    for (const file of editedFiles) {
      const flatName = file.replace(/[\\/]/g, '--')
      const lockPath = `${lockDir}/${flatName}.lock`
      const hasLock = await exists(lockPath)
      if (!hasLock) {
        checks.push({
          protocol: 'locks',
          passed: false,
          message: `No lock for edited file: ${file}`,
        })
      }
    }
    return checks
  },

  'cross-team': async (_directory: string, _editedFiles: string[], _state: any) => {
    const checks = []
    const changesPath = 'CHANGES_REQUIRED.md'
    const hasChanges = await exists(changesPath)
    if (hasChanges) {
      const content = await readFile(changesPath, 'utf-8')
      const unresolved = content
        .split('## ')
        .filter((s: string) => s.includes('Priority:') && !s.includes('Resolved:')).length
      if (unresolved > 0) {
        checks.push({
          protocol: 'cross-team',
          passed: false,
          message: `${unresolved} unresolved cross-team requirements in CHANGES_REQUIRED.md`,
        })
      }
    }
    return checks
  },

  'library-selection': async (_directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    if (_state.currentPhase === 'PLAN') {
      const planFiles = editedFiles.filter((f) => f.includes('plan') || f.includes('Plan'))
      if (planFiles.length > 0) {
        checks.push({
          protocol: 'library-selection',
          passed: true,
          message:
            'PLAN phase - if adding new dependencies, verify library selection protocol (value density, maintenance, security, type safety, license, migration path)',
        })
      }
    }
    if (_state.currentPhase === 'PATCH' || _state.currentPhase === 'DOCS') {
      const depFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml']
      for (const depFile of depFiles) {
        if (
          editedFiles.includes(depFile) ||
          editedFiles.some((f) => f.startsWith(depFile.replace('.json', '').replace('.toml', '')))
        ) {
          checks.push({
            protocol: 'library-selection',
            passed: true,
            message: 'Dependency file modified - verify library selection protocol was followed',
          })
        }
      }
    }
    return checks
  },

  'spec-exists': async (_directory: string, _editedFiles: string[], state: any) => {
    const checks = []
    const specsDir = 'SPECS'
    const hasSpecs = await exists(specsDir)
    const specVersion = state.specVersion
    if (!hasSpecs || !specVersion) {
      checks.push({
        protocol: 'spec',
        passed: false,
        message: 'No SPECS/ directory or spec_version not set - DRIFT not applicable',
      })
    }
    return checks
  },

  'review-complete': async (_directory: string, _editedFiles: string[], _state: any) => {
    return [
      {
        protocol: 'review',
        passed: true,
        message: 'Verify REVIEW decision section confirmed in session state',
      },
    ]
  },

  'plan-approved': async (_directory: string, _editedFiles: string[], _state: any) => {
    return [{ protocol: 'plan', passed: true, message: 'Verify PLAN approval in session state' }]
  },

  'rewrite-contract': async (_directory: string, _editedFiles: string[], _state: any) => {
    return [
      {
        protocol: 'rewrite-contract',
        passed: true,
        message: 'Verify rewrite contract complete in session state',
      },
    ]
  },

  discovery: async (_directory: string, _editedFiles: string[], _state: any) => {
    return [
      {
        protocol: 'discovery',
        passed: true,
        message: 'Run relevance discovery for directory/glob targets',
      },
    ]
  },

  'api-design': async (_directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    const apiFiles = editedFiles.filter(
      (f) =>
        f.includes('api') ||
        f.includes('route') ||
        f.includes('endpoint') ||
        f.includes('controller') ||
        f.includes('handler') ||
        f.includes('openapi')
    )
    if (apiFiles.length > 0) {
      checks.push({
        protocol: 'api-design',
        passed: true,
        message: 'API files modified - verify API architecture protocol',
      })
    }
    return checks
  },

  'code-decision-ladder': async (_directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    if (editedFiles.length > 0) {
      checks.push({
        protocol: 'code-decision-ladder',
        passed: true,
        message:
          "REVIEW/PATCH: Verify new code doesn't duplicate existing utilities (grep), stdlib, or installed deps (H28). Check existing code -> stdlib -> installed deps -> then write new.",
      })
    }
    return checks
  },

  'library-first': async (directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    if (editedFiles.length > 0) {
      const packageJsonPath = `${directory}/package.json`
      const hasPackageJson = await exists(packageJsonPath)
      if (hasPackageJson) {
        const pkg = JSON.parse(await readFile(packageJsonPath, 'utf-8'))
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
        const patterns = [
          {
            pattern: /date-?fns|dayjs|moment|luxon/i,
            lib: 'date-fns/dayjs/luxon',
            desc: 'date parsing/formatting',
          },
          { pattern: /zod|yup|joi|valibot/i, lib: 'zod/yup/valibot', desc: 'validation' },
          { pattern: /lodash|ramda|underscore/i, lib: 'lodash/ramda', desc: 'utility functions' },
          { pattern: /axios|ky|got|fetch/i, lib: 'axios/ky/native fetch', desc: 'HTTP client' },
          {
            pattern: /clsx|classnames|tailwind-merge/i,
            lib: 'clsx/tailwind-merge',
            desc: 'className composition',
          },
          {
            pattern: /uuid|nanoid|crypto\.randomUUID/i,
            lib: 'uuid/nanoid/crypto.randomUUID',
            desc: 'ID generation',
          },
          {
            pattern: /zustand|jotai|redux|recoil/i,
            lib: 'zustand/jotai/redux',
            desc: 'state management',
          },
          {
            pattern: /react-hook-form|formik|zod/i,
            lib: 'react-hook-form/zod',
            desc: 'forms + validation',
          },
          { pattern: /date-fns-tz|timezone/i, lib: 'date-fns-tz', desc: 'timezone handling' },
          {
            pattern: /decimal\.js|big\.js|bignumber\.js/i,
            lib: 'decimal.js',
            desc: 'precision math',
          },
        ]
        for (const { pattern, lib, desc } of patterns) {
          if (pattern.test(JSON.stringify(allDeps))) {
            checks.push({
              protocol: 'library-first',
              passed: true,
              message: `H14: ${lib} installed for ${desc} - verify new code uses it instead of hand-rolling`,
            })
          }
        }
      }
    }
    return checks
  },
}

async function checkProtocols(state: ProtocolState, directory: string) {
  const requiredProtocols =
    PHASE_TRANSITIONS[state.currentPhase as keyof typeof PHASE_TRANSITIONS] || []
  const allChecks = []

  for (const protocol of requiredProtocols) {
    if (state.protocolsChecked.has(protocol)) continue
    const checkFn = PROTOCOL_CHECKS[protocol as keyof typeof PROTOCOL_CHECKS]
    if (checkFn) {
      const checks = await checkFn(directory, state.editedFiles, state)
      allChecks.push(...checks)
      state.protocolsChecked.add(protocol)
    }
  }

  return allChecks
}

export default async ({
  client,
  $,
  project,
  directory,
  worktree,
}: {
  client: any
  $: any
  project: any
  directory: string
  worktree: string
}) => {
  return {
    event: async ({ event }: { event: any }) => {
      const sessionId = event.properties?.sessionID
      if (!sessionId) return

      let state = protocolStates.get(sessionId)
      if (!state) {
        state = {
          sessionId,
          currentPhase: 'STARTUP',
          specVersion: null,
          hasSpec: false,
          editedFiles: [],
          protocolsChecked: new Set(),
        }
        protocolStates.set(sessionId, state)
      }

      if (event.type === 'session.created') {
        state.currentPhase = 'STARTUP'
        state.protocolsChecked.clear()
        console.log(`[protocol-enforce] Session ${sessionId} created, phase: STARTUP`)
        return
      }

      if (event.type === 'session.deleted') {
        protocolStates.delete(sessionId)
        console.log(`[protocol-enforce] Session ${sessionId} deleted`)
        return
      }
    },

    'experimental.chat.messages.transform': async ({
      input,
      output,
    }: {
      input: any
      output: { messages: any[] }
    }) => {
      const sessionId = input.sessionID ?? input.session_id
      if (!sessionId) return

      const state = protocolStates.get(sessionId)
      if (!state) return

      updatePhaseFromMessages(sessionId, output.messages)

      const newPhase = getCurrentPhase(sessionId)
      if (!newPhase || newPhase === state.currentPhase) return

      const previousPhase = state.currentPhase
      state.currentPhase = newPhase
      state.protocolsChecked.clear()

      console.log(
        `[protocol-enforce] Session ${sessionId} phase transition: ${previousPhase} -> ${newPhase}`
      )

      const checks = await checkProtocols(state, directory)
      const failed = checks.filter((c) => !c.passed)

      if (failed.length > 0) {
        console.log(
          `[protocol-enforce] Protocol checks failed for ${newPhase}:`,
          failed.map((f) => `${f.protocol}: ${f.message}`).join(', ')
        )
      }
    },
  }
}
