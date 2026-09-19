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
 * Runs automatically at session phase transitions via event hooks.
 */

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
  // Phase -> required protocols to check before entering
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
  'artifact-handling': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    const checks = []

    // Check .gitignore exists and has required entries
    const gitignorePath = `${directory}/.gitignore`
    const hasGitignore = await $.exists(gitignorePath)
    if (!hasGitignore) {
      checks.push({ protocol: 'artifact-handling', passed: false, message: '.gitignore missing' })
    } else {
      const content = await $.readText(gitignorePath)
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

    // Check .gitattributes exists
    const gitattributesPath = `${directory}/.gitattributes`
    const hasGitattributes = await $.exists(gitattributesPath)
    if (!hasGitattributes) {
      checks.push({
        protocol: 'gitattributes',
        passed: false,
        message: '.gitattributes missing (recommend: * text=auto eol=lf)',
      })
    }

    return checks
  },

  'pre-commit': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    const checks = []
    const precommitPath = `${directory}/.pre-commit-config.yaml`
    const huskyPath = `${directory}/.husky/pre-commit`

    const hasPrecommit = await $.exists(precommitPath)
    const hasHusky = await $.exists(huskyPath)

    if (!hasPrecommit && !hasHusky) {
      checks.push({
        protocol: 'pre-commit',
        passed: false,
        message: 'No pre-commit hooks configured (pre-commit or husky)',
      })
    } else {
      // Check for common required hooks
      if (hasPrecommit) {
        const content = await $.readText(precommitPath)
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

  locks: async ($: any, directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    const lockDir = `${directory}/.session-locks`
    const hasLockDir = await $.exists(lockDir)

    if (!hasLockDir && editedFiles.length > 0) {
      checks.push({
        protocol: 'locks',
        passed: false,
        message: 'No .session-locks directory but files were edited',
      })
    }

    // Check each edited file has a lock
    for (const file of editedFiles) {
      const flatName = file.replace(/[\\/]/g, '--')
      const lockPath = `${lockDir}/${flatName}.lock`
      const hasLock = await $.exists(lockPath)
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

  'cross-team': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    const checks = []
    const changesPath = `${directory}/CHANGES_REQUIRED.md`
    const hasChanges = await $.exists(changesPath)
    if (hasChanges) {
      const content = await $.readText(changesPath)
      // Check for unresolved entries (no "Resolved:" marker)
      const unresolved = content
        .split('## ')
        .filter((s) => s.includes('Priority:') && !s.includes('Resolved:')).length
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

  'library-selection': async ($: any, directory: string, editedFiles: string[], state: any) => {
    const checks = []

    // At PLAN phase: check if plan mentions new dependencies
    if (state.currentPhase === 'PLAN') {
      // Look for plan files that might indicate new deps
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

    // At PATCH/DOCS phase: check if dependency files were actually modified
    if (state.currentPhase === 'PATCH' || state.currentPhase === 'DOCS') {
      const depFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml']
      for (const depFile of depFiles) {
        const path = `${directory}/${depFile}`
        if (
          editedFiles.includes(depFile) ||
          ((await $.exists(path)) &&
            editedFiles.some((f) =>
              f.startsWith(depFile.replace('.json', '').replace('.toml', ''))
            ))
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

  'spec-exists': async ($: any, directory: string, _editedFiles: string[], state: any) => {
    const checks = []
    const specsDir = `${directory}/SPECS`
    const hasSpecs = await $.exists(specsDir)
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

  'review-complete': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    // This would check session state for review completion
    return [
      {
        protocol: 'review',
        passed: true,
        message: 'Verify REVIEW decision section confirmed in session state',
      },
    ]
  },

  'plan-approved': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    return [{ protocol: 'plan', passed: true, message: 'Verify PLAN approval in session state' }]
  },

  'rewrite-contract': async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    return [
      {
        protocol: 'rewrite-contract',
        passed: true,
        message: 'Verify rewrite contract complete in session state',
      },
    ]
  },

  discovery: async ($: any, directory: string, _editedFiles: string[], _state: any) => {
    return [
      {
        protocol: 'discovery',
        passed: true,
        message: 'Run relevance discovery for directory/glob targets',
      },
    ]
  },

  'api-design': async ($: any, directory: string, editedFiles: string[], state: any) => {
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

  'code-decision-ladder': async ($: any, directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    // H28: Check if new code duplicates existing utility/stdlib/installed-deps
    // This is a heuristic - would need actual diff analysis
    if (editedFiles.length > 0) {
      checks.push({
        protocol: 'code-decision-ladder',
        passed: true,
        message:
          "REVIEW/PATCH: Verify new code doesn't duplicate existing utilities (grep), stdlib, or installed deps (H28). Check existing code → stdlib → installed deps → then write new.",
      })
    }
    return checks
  },

  'library-first': async ($: any, directory: string, editedFiles: string[], _state: any) => {
    const checks = []
    // H14: Library-First - check if hand-rolling logic that installed lib already solves
    if (editedFiles.length > 0) {
      // Check for common hand-rolled patterns vs installed packages
      const packageJsonPath = `${directory}/package.json`
      const hasPackageJson = await $.exists(packageJsonPath)
      if (hasPackageJson) {
        const pkg = JSON.parse(await $.readText(packageJsonPath))
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

        // Common patterns that often have library solutions
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

async function checkProtocols(state: ProtocolState, $: any, directory: string) {
  const requiredProtocols =
    PHASE_TRANSITIONS[state.currentPhase as keyof typeof PHASE_TRANSITIONS] || []
  const allChecks = []

  for (const protocol of requiredProtocols) {
    if (state.protocolsChecked.has(protocol)) continue

    const checkFn = PROTOCOL_CHECKS[protocol as keyof typeof PROTOCOL_CHECKS]
    if (checkFn) {
      const checks = await checkFn($, directory, state.editedFiles, state)
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

      // Session created
      if (event.type === 'session.created') {
        state.currentPhase = 'STARTUP'
        state.protocolsChecked.clear()
        console.log(`[protocol-enforce] Session ${sessionId} created, phase: STARTUP`)
        return
      }

      // Track phase from session metadata
      if (event.type === 'session.updated') {
        const info = event.properties?.info
        if (info?.metadata?.phase) {
          const newPhase = info.metadata.phase
          if (newPhase !== state.currentPhase) {
            console.log(
              `[protocol-enforce] Session ${sessionId} phase transition: ${state.currentPhase} -> ${newPhase}`
            )

            // Run protocol checks for new phase
            const checks = await checkProtocols(state, $, directory)

            const failed = checks.filter((c) => !c.passed)
            if (failed.length > 0) {
              // Send blocking notification
              const msg =
                `Protocol checks failed for ${newPhase}:\n` +
                failed.map((f) => `- ${f.protocol}: ${f.message}`).join('\n')

              try {
                await $`opencode tui toast show --title "Protocol Check Failed" --message "${msg}" --variant error`
              } catch (e) {
                console.error(`[protocol-enforce] Toast failed:`, e)
              }

              // Also send as system message to agent
              try {
                await client.message.create({
                  sessionID: sessionId,
                  role: 'system',
                  content: `PROTOCOL ENFORCEMENT: Cannot enter ${newPhase} phase.\nFailed checks:\n${failed.map((f) => `- ${f.protocol}: ${f.message}`).join('\n')}\nFix these before proceeding.`,
                })
              } catch (e) {
                console.error(`[protocol-enforce] Message create failed:`, e)
              }
            }

            state.currentPhase = newPhase
          }

          // Track spec version
          if (info?.metadata?.spec_version) {
            state.specVersion = info.metadata.spec_version
            state.hasSpec = true
          }

          // Track edited files
          if (info?.metadata?.edited_files) {
            state.editedFiles = info.metadata.edited_files
          }
        }
      }

      // Session deleted
      if (event.type === 'session.deleted') {
        protocolStates.delete(sessionId)
        console.log(`[protocol-enforce] Session ${sessionId} deleted`)
        return
      }
    },
  }
}
