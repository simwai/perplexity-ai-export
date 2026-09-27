import { spawn } from 'node:child_process'
import stripAnsi from 'strip-ansi'

/**
 * Reduce an arbitrary string to a filesystem-safe component.
 * - ASCII alphanumerics, `.`, `_`, `-` are kept
 * - Everything else collapses to a single `-`
 * - Leading/trailing `-` and `.` are stripped (blocks `..`, hidden files)
 * - Length is capped so filesystem NAME_MAX is never approached
 * - Lowercases for consistency
 * - Unicode normalized to ASCII (NFKD + strip combining marks)
 *
 * Note: this is for the *sluggish* part of a filename. Do NOT rely on it as
 * a security boundary on its own — always pair it with `assertSafeFilename`.
 */
export function slugify(input: string, maxLength = 80): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, maxLength)
    .toLowerCase()
  return cleaned || 'untitled'
}

/**
 * Assert a string is safe to use as a single path component.
 * Throws rather than silently sanitizing — callers that build paths from
 * untrusted strings must opt in to sanitization explicitly via slugify().
 */
export function assertSafeFilename(name: string): void {
  if (name.length === 0) throw new Error('empty filename')
  if (name === '.' || name === '..') throw new Error(`reserved filename: ${name}`)
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`path separator in filename: ${name}`)
  }
  if (name.includes('\0')) throw new Error('NUL byte in filename')
  if (/[\x00-\x1f\x7f]/.test(name)) throw new Error('control character in filename')
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`disallowed char in filename: ${name}`)
}

/**
 * Run a child process safely. shell:false means args[] is passed as argv
 * directly — no shell metacharacter interpretation, ever.
 *
 * The only remaining risk is a path argument starting with `-` being parsed
 * as a flag (e.g. `--no-preserve-root`). Callers must either prefix such
 * paths with `./` or pass `--` where the tool supports it.
 */
export function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    )
  })
}

/** Prefix a path with `./` if it looks like it could be parsed as a flag. */
export function safePathArg(p: string): string {
  return p.startsWith('-') ? `./${p}` : p
}

/**
 * Strip ANSI escape sequences and control characters from a string
 * for safe logging. Prevents terminal escape sequence injection.
 * Uses `strip-ansi` for CSI sequences, adds OSC and control char handling.
 */
export function safeLog(input: string): string {
  return stripAnsi(input)
    .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences (window title, hyperlinks)
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '') // other control chars
    .trim()
}
