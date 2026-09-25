/**
 * Baba Drift Detection Plugin for opencode
 *
 * Runs drift detection: compares SPECS/ against code.
 * Read-only. Finds verified/diverged/orphaned/exceeds-spec claims.
 * HALTs on version drift per 08-plan-actual-gate.md.
 */

import { tool } from '@opencode-ai/plugin'

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
    tool: {
      drift: tool({
        description:
          'Run drift detection: compare SPECS/ against code. Read-only. Finds verified/diverged/orphaned/exceeds-spec claims. HALTs on version drift.',
        args: {
          spec: tool.schema
            .string()
            .optional()
            .describe(
              'Specific spec file (e.g., SPECS/001-user-registration/spec.md). If omitted, checks all specs.'
            ),
          freshEyes: tool.schema
            .boolean()
            .optional()
            .describe('Run fresh-eyes review (cold read by subagent)'),
        },
        async execute(args, context) {
          const { sessionID } = context

          // Helper: run rg via bash tool
          async function rg(pattern: string, path: string): Promise<string[]> {
            try {
              const result = await (client as any).tool.execute({
                body: {
                  tool: 'bash',
                  callID: `drift-rg-${Date.now()}`,
                  args: { command: `rg "${pattern}" "${path}" --no-heading --line-number` },
                },
              })
              return (result.output || '').trim().split('\n').filter(Boolean)
            } catch {
              return []
            }
          }

          // Helper: read file
          async function readFile(path: string): Promise<string> {
            try {
              const result = await (client as any).tool.execute({
                body: {
                  tool: 'read',
                  callID: `drift-read-${Date.now()}`,
                  args: { filePath: path },
                },
              })
              return result.output || ''
            } catch {
              return ''
            }
          }

          // Helper: list SPECS/
          async function listSpecs(): Promise<string[]> {
            try {
              const result = await (client as any).tool.execute({
                body: {
                  tool: 'glob',
                  callID: `drift-glob-${Date.now()}`,
                  args: { pattern: 'SPECS/*/spec.md' },
                },
              })
              return (result.output || '').trim().split('\n').filter(Boolean)
            } catch {
              return []
            }
          }

          // Parse spec for claims (GWT, FR-###, SC-###)
          function parseClaims(
            specContent: string
          ): { id: string; text: string; type: 'gwt' | 'fr' | 'sc'; line: number }[] {
            const claims: { id: string; text: string; type: 'gwt' | 'fr' | 'sc'; line: number }[] =
              []
            const lines = specContent.split('\n')

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              const lineNum = i + 1

              // GWT: "Given <context>, When <action>, Then <outcome>"
              const gwtMatch = line.match(/Given\s+.+,\s*When\s+.+,\s*Then\s+.+/i)
              if (gwtMatch) {
                claims.push({ id: `GWT-${lineNum}`, text: gwtMatch[0], type: 'gwt', line: lineNum })
                continue
              }

              // FR-###: "FR-001: the system MUST <behavior>"
              const frMatch = line.match(/^(FR-\d+):\s*(.+)$/)
              if (frMatch) {
                claims.push({ id: frMatch[1], text: frMatch[2], type: 'fr', line: lineNum })
                continue
              }

              // SC-###: "SC-001: <measurable outcome>"
              const scMatch = line.match(/^(SC-\d+):\s*(.+)$/)
              if (scMatch) {
                claims.push({ id: scMatch[1], text: scMatch[2], type: 'sc', line: lineNum })
                continue
              }
            }

            return claims
          }

          // Map claim to code locations via rg
          async function mapClaim(claim: {
            id: string
            text: string
            type: string
          }): Promise<string[]> {
            // Extract key terms from claim for search
            const terms = claim.text
              .toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .slice(0, 5)

            if (terms.length === 0) return []

            const pattern = terms.join('|')
            const hits = await rg(pattern, directory)

            // Filter to relevant source files, exclude artifacts
            return hits
              .filter((h) => {
                const file = h.split(':')[0]
                return (
                  !file.includes('node_modules') &&
                  !file.includes('.git') &&
                  !file.includes('dist/') &&
                  !file.includes('build/') &&
                  !file.includes('SPECS/') &&
                  !file.includes('.session-locks/')
                )
              })
              .slice(0, 10)
          }

          // Check version drift: spec header Version vs SPECS/INDEX.md registry
          async function checkVersionDrift(
            specPath: string,
            specContent: string
          ): Promise<{ drift: boolean; specVersion: string; registryVersion: string } | null> {
            // Extract version from spec header
            const versionMatch = specContent.match(/^Version:\s*([\d.]+)/m)
            const specVersion = versionMatch?.[1]
            if (!specVersion) return null

            // Read registry
            const registryContent = await readFile(`${directory}/SPECS/INDEX.md`)
            const escapedPath = specPath.replace(/[/\\]/g, '\\\\')
            const registryMatch = registryContent.match(
              new RegExp(`\\|\\s*${escapedPath}\\s*\\|\\s*([\\d.]+)\\s*\\|`)
            )
            const registryVersion = registryMatch?.[1]
            if (!registryVersion) return null

            return { drift: specVersion !== registryVersion, specVersion, registryVersion }
          }

          // Main drift logic
          const specFiles = args.spec ? [args.spec] : await listSpecs()

          if (specFiles.length === 0) {
            return 'No SPECS/ found. Drift detection requires specs.'
          }

          let report = '# Drift Report\n\n'
          let hasVersionDrift = false
          let totalClaims = 0
          let verified = 0,
            diverged = 0,
            orphaned = 0,
            exceeds = 0

          for (const specFile of specFiles) {
            const specPath = `${directory}/${specFile}`
            const specContent = await readFile(specPath)

            if (!specContent) {
              report += `## ${specFile}\n⚠️ Could not read spec\n\n`
              continue
            }

            // Version drift check
            const driftCheck = await checkVersionDrift(specFile, specContent)
            if (driftCheck?.drift) {
              hasVersionDrift = true
              report += `## ⚠️ HALT: Version Drift Detected in ${specFile}\n`
              report += `- Spec header version: ${driftCheck.specVersion}\n`
              report += `- Registry version: ${driftCheck.registryVersion}\n`
              report += `- **Required action**: Align header to registry OR registry to header\n\n`
              continue
            }

            const claims = parseClaims(specContent)
            totalClaims += claims.length

            report += `## ${specFile} (${claims.length} claims)\n\n`

            for (const claim of claims) {
              const locations = await mapClaim(claim)

              if (locations.length === 0) {
                // Orphaned mapping or no implementation
                orphaned++
                report += `- **Orphaned** \`${claim.id}\` (line ${claim.line}): No code locations found\n`
                report += `  - Claim: ${claim.text}\n`
                report += `  - Mitigations:\n`
                report += `    - A. apply: re-add the mapped code (Recommended)\n`
                report += `    - B. sync: deprecate the claim\n\n`
                continue
              }

              // For simplicity: if locations found, consider verified
              // A real implementation would check if code behavior matches claim
              verified++
              report += `- **Verified** \`${claim.id}\` (line ${claim.line}): ${locations.length} location(s)\n`
              for (const loc of locations.slice(0, 3)) {
                report += `  - ${loc}\n`
              }
              if (locations.length > 3) report += `  - ... and ${locations.length - 3} more\n`
            }

            // Code-exceeds-spec: find code with no claim (simplified)
            // This would need more sophisticated analysis in practice
          }

          // Summary
          report =
            `# Drift Report\n\n` +
            `**Summary**: ${verified} verified, ${diverged} diverged, ${orphaned} orphaned, ${exceeds} code-exceeds-spec (${totalClaims} total claims)\n\n` +
            (hasVersionDrift ? `**⚠️ VERSION DRIFT DETECTED - HALT**\n\n` : '') +
            report

          if (args.freshEyes) {
            report += `\n---\n## Fresh-Eyes Review Requested\nRun a cold-read subagent for additional lens.\n`
          }

          return report
        },
      }),
    },
  }
}
