import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export function shimPath(): {
  resolve: (...segments: string[]) => string
  join: (...segments: string[]) => string
  dirname: (p: string) => string
  basename: (p: string) => string
  isAbsolute: (p: string) => boolean
  sep: string
} {
  return { resolve, join, dirname, basename, isAbsolute, sep }
}
