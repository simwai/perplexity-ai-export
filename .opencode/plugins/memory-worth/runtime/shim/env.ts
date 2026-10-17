export function shimEnv(): {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
} {
  const env = globalThis.process?.env
  return {
    get: (key: string) => (typeof env?.[key] === 'string' ? env[key] : undefined),
    set: (key: string, value: string) => {
      if (env) env[key] = value
    },
  }
}
