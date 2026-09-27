import { describe, it, expect, vi } from 'vitest'
import { slugify } from '../../src/export/sanitizer.js'
import {
  assertSafeFilename,
  safePathArg,
  safeLog,
  runCommand,
} from '../../src/utils/shell-safety.js'

describe('slugify', () => {
  it('should convert unicode to ascii', () => {
    expect(slugify('café')).toBe('cafe')
    expect(slugify('naïve')).toBe('naive')
  })

  it('should collapse multiple special chars to single hyphen', () => {
    expect(slugify('a  b---c')).toBe('a-b-c')
  })

  it('should strip leading/trailing hyphens and dots', () => {
    expect(slugify('.-test-.')).toBe('test')
  })

  it('should lowercase the result', () => {
    expect(slugify('TEST')).toBe('test')
  })

  it('should return untitled for empty input', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('should respect maxLength parameter', () => {
    expect(slugify('a'.repeat(100), 10)).toHaveLength(10)
  })

  it('should handle malicious input from Perplexity titles', () => {
    const malicious =
      '@IOT2050-1:~$ pm2 reload\n-bash: /home/IOT/.nvm/versions/node/v20.16.0/bin/pm2: Datei oder Verzeichnis nicht gefunden\nIOT@IOT2050-1:~$ '
    const result = slugify(malicious)
    expect(result).not.toMatch(/[\n$~`]/)
    expect(result).not.toContain('--')
    expect(result).toMatch(/^[a-z0-9.-]+$/)
  })
})

describe('assertSafeFilename', () => {
  it('should pass for valid safe filenames', () => {
    expect(() => assertSafeFilename('valid-file.md')).not.toThrow()
    expect(() => assertSafeFilename('file_name.txt')).not.toThrow()
    expect(() => assertSafeFilename('file.name.json')).not.toThrow()
    expect(() => assertSafeFilename('a')).not.toThrow()
    expect(() => assertSafeFilename('a-b-c')).not.toThrow()
  })

  it('should throw for empty string', () => {
    expect(() => assertSafeFilename('')).toThrow('empty filename')
  })

  it('should throw for reserved names', () => {
    expect(() => assertSafeFilename('.')).toThrow('reserved filename')
    expect(() => assertSafeFilename('..')).toThrow('reserved filename')
  })

  it('should throw for path separators', () => {
    expect(() => assertSafeFilename('path/to/file')).toThrow('path separator')
    expect(() => assertSafeFilename('path\\to\\file')).toThrow('path separator')
  })

  it('should throw for NUL byte', () => {
    expect(() => assertSafeFilename('file\0name')).toThrow('NUL byte')
  })

  it('should throw for control characters', () => {
    expect(() => assertSafeFilename('file\nname')).toThrow('control character')
    expect(() => assertSafeFilename('file\rname')).toThrow('control character')
    expect(() => assertSafeFilename('file\tname')).toThrow('control character')
    expect(() => assertSafeFilename('\x7fname')).toThrow('control character')
  })

  it('should throw for disallowed characters', () => {
    expect(() => assertSafeFilename('file:name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file*name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file?name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file"name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file<name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file>name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file|name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file$name')).toThrow('disallowed char')
    expect(() => assertSafeFilename('file`name')).toThrow('disallowed char')
  })

  it('should allow hyphens anywhere (flag-like names are valid filenames; use safePathArg for CLI)', () => {
    expect(() => assertSafeFilename('--no-preserve-root')).not.toThrow()
    expect(() => assertSafeFilename('-rf')).not.toThrow()
    expect(() => assertSafeFilename('my-file.txt')).not.toThrow()
  })
})

describe('safePathArg', () => {
  it('should prefix paths starting with hyphen', () => {
    expect(safePathArg('-file.txt')).toBe('./-file.txt')
    expect(safePathArg('--flag')).toBe('./--flag')
    expect(safePathArg('-rf')).toBe('./-rf')
  })

  it('should not modify normal paths', () => {
    expect(safePathArg('file.txt')).toBe('file.txt')
    expect(safePathArg('./file.txt')).toBe('./file.txt')
    expect(safePathArg('path/to/file')).toBe('path/to/file')
    expect(safePathArg('normal-file.txt')).toBe('normal-file.txt')
  })
})

describe('safeLog', () => {
  it('should strip CSI escape sequences (colors)', () => {
    const input = '\x1b[31mred\x1b[0m text'
    expect(safeLog(input)).toBe('red text')
  })

  it('should strip cursor movement sequences', () => {
    const input = '\x1b[2J\x1b[Hclear screen'
    expect(safeLog(input)).toBe('clear screen')
  })

  it('should strip OSC sequences (window title)', () => {
    const input = '\x1b]0;Title\x07content'
    expect(safeLog(input)).toBe('content')
  })

  it('should strip other control characters', () => {
    const input = 'before\x00\x01\x02\x07\x08\x0b\x0c\x0e\x1f\x7fafter'
    expect(safeLog(input)).toBe('beforeafter')
  })

  it('should trim whitespace', () => {
    expect(safeLog('  hello  ')).toBe('hello')
    expect(safeLog('\n\thello\n')).toBe('hello')
  })

  it('should handle malicious terminal injection attempts', () => {
    // OSC 8 hyperlink injection attempt
    const input = '\x1b]8;;https://evil.com\x07click\x1b]8;;\x07'
    expect(safeLog(input)).toBe('click')

    // CSI cursor position injection
    const input2 = '\x1b[999;999Hmalicious'
    expect(safeLog(input2)).toBe('malicious')
  })

  it('should return empty string for only control chars', () => {
    expect(safeLog('\x1b[31m')).toBe('')
    expect(safeLog('\x00\x01\x02')).toBe('')
  })

  it('should preserve normal text', () => {
    expect(safeLog('Normal text with numbers 123')).toBe('Normal text with numbers 123')
    expect(safeLog('Special chars: !@#$%^&*()')).toBe('Special chars: !@#$%^&*()')
  })
})

describe('runCommand', () => {
  it('should be exported as a function', () => {
    expect(typeof runCommand).toBe('function')
  })

  it('should reject on non-zero exit code', async () => {
    await expect(runCommand('nonexistent-command-xyz', [])).rejects.toThrow()
  })

  it('should reject on command not found', async () => {
    await expect(runCommand('definitely-not-a-real-command-12345', ['arg'])).rejects.toThrow()
  })
})
