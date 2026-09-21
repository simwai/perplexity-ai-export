export function shimProcess(): {
  cwd: () => string
  platform: string
  arch: string
} {
  const proc = globalThis.process
  return {
    cwd: () => proc.cwd(),
    platform: proc.platform,
    arch: proc.arch,
  }
}
