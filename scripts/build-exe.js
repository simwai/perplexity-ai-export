import { build } from 'esbuild'
import { existsSync, mkdirSync, copyFileSync, rmSync, cpSync, readdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
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

// In caxa, __dirname is the extraction directory where bundle.cjs lives
const require_ = createRequire(__filename);

// Set environment variables for self-contained execution
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, 'browsers');
process.env.RIPGREP_PATH = path.join(__dirname, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');

const originalResolve = require.resolve;
require.resolve = (id, options) => {
  if (id.includes('package.json')) return path.resolve(__dirname, 'package.json');

  // Ripgrep resolution override
  if (id.includes('@vscode/ripgrep-win32-x64')) {
    return path.resolve(__dirname, 'bin/rg.exe');
  }
  if (id.includes('@vscode/ripgrep')) {
    return path.resolve(__dirname, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  }

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

  // Create a minimal package.json for caxa
  writeFileSync(join(stagingDir, 'package.json'), JSON.stringify({
    name: "perplexity-history-export-staging",
    version: "1.0.0",
    private: true
  }))

  // Copy Ripgrep
  console.log('--- Copying Ripgrep ---')
  const rgDestDir = join(stagingDir, 'bin')
  mkdirSync(rgDestDir, { recursive: true })
  const rgSource = join(projectRoot, 'node_modules', '@vscode', 'ripgrep-win32-x64', 'bin', 'rg.exe')
  if (existsSync(rgSource)) {
    copyFileSync(rgSource, join(rgDestDir, 'rg.exe'))
    console.log('Copied Windows ripgrep binary')
  } else {
    console.warn('Warning: Windows ripgrep binary not found at', rgSource)
  }

  // Copy native modules from pnpm store (symlink‑proof)
  console.log('--- Copying Native Modules ---')
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

  // ── 3. Install Playwright Browsers ───────────────────────
  console.log('--- Installing Playwright Browsers (Chromium) ---')
  const browsersDir = join(stagingDir, 'browsers')
  mkdirSync(browsersDir, { recursive: true })

  try {
    execSync(`npx playwright install chromium`, {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
      stdio: 'inherit'
    })
    console.log('Chromium installed in staging directory')
  } catch (e) {
    console.error('Failed to install Playwright browsers:', e.message)
  }

  // ── 4. Package with caxa ──────────────────────────────────
  console.log('--- Packaging with caxa ---')
  await caxa({
    input: stagingDir,
    output: outputExePath,
    command: ['{{node}}', 'bundle.cjs'],
    exclude: ['node_modules/.bin', 'node_modules/@types']
  })

  console.log(`\n✅ Successfully created ${outputExePath}`)
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
