import { build } from 'esbuild'
import { existsSync, mkdirSync, copyFileSync, rmSync, cpSync, readdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import caxa from 'caxa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

async function main() {
  const isWindows = process.platform === 'win32'
  const outDir = join(projectRoot, 'dist')
  const bundleFile = join(outDir, 'bundle.cjs')
  const stagingDir = join(outDir, 'staging')
  const outputExeName = 'perplexity-history-export' + (isWindows ? '.exe' : '')
  const outputExePath = join(outDir, outputExeName)

  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true })
  }
  mkdirSync(outDir, { recursive: true })

  // ── 1. Bundle with esbuild ────────────────────────────────
  console.log('--- Bundling with esbuild (CJS) ---')
  await build({
    entryPoints: [join(projectRoot, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: bundleFile,
    format: 'cjs',
    alias: { '@playwright/test': 'playwright-core' },
    banner: {
      js: `
const { createRequire } = require('module');
const path = require('path');
const require_ = createRequire(process.cwd() + '/index.js');
const originalResolve = require.resolve;
require.resolve = (id, options) => {
  if (id.includes('package.json')) return path.resolve(process.cwd(), 'package.json');
  if (id.includes('appIcon.png')) return path.resolve(process.cwd(), 'appIcon.png');
  if (id.includes('./loader')) return path.resolve(process.cwd(), 'loader.js');
  try {
    return originalResolve(id, options);
  } catch (e) {
    try {
      return require_.resolve(id, options);
    } catch (e2) {
      return id;
    }
  }
};
`,
    },
    external: ['fsevents', 'onnxruntime-node', 'onnxruntime-common'],
    logOverride: { 'require-resolve-not-external': 'silent' },
  })

  // ── 2. Prepare staging directory ──────────────────────────
  console.log('--- Preparing staging directory ---')
  mkdirSync(stagingDir, { recursive: true })
  copyFileSync(bundleFile, join(stagingDir, 'bundle.cjs'))

  // Assets
  for (const asset of ['appIcon.png', 'loader.js']) {
    const src = join(projectRoot, asset)
    if (existsSync(src)) copyFileSync(src, join(stagingDir, asset))
  }

  // Copy native modules from pnpm store (symlink‑proof)
  const pnpmDir = join(projectRoot, 'node_modules', '.pnpm')
  for (const mod of ['onnxruntime-node', 'onnxruntime-common']) {
    try {
      const entries = readdirSync(pnpmDir)
      const pkgDir = entries.find((d) => d.startsWith(mod + '@'))
      if (!pkgDir) continue
      const realPath = join(pnpmDir, pkgDir, 'node_modules', mod)
      const dest = join(stagingDir, 'node_modules', mod)
      cpSync(realPath, dest, { recursive: true, dereference: true })
      console.log(`Copied ${mod}`)
    } catch (e) {
      console.warn(`Warning: could not copy ${mod}:`, e.message)
    }
  }

  // ── 3. Package with caxa ──────────────────────────────────
  console.log('--- Packaging with caxa ---')
  await caxa({
    input: stagingDir,
    output: outputExePath,
    command: ['node', 'bundle.cjs'],
  })

  console.log(`\n✅ Successfully created ${outputExePath}`)
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
