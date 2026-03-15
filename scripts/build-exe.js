import { build } from 'esbuild';
import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import process from 'process';

async function main() {
  const isWindows = process.platform === 'win32';
  const outDir = 'dist';
  const bundleFile = join(outDir, 'bundle.cjs');
  const blobFile = join(outDir, 'sea-prep.blob');
  const nodeExe = process.execPath;
  const outputExeName = 'perplexity-history-export' + (isWindows ? '.exe' : '');
  const outputExePath = join(outDir, outputExeName);

  if (!existsSync(outDir)) {
    mkdirSync(outDir);
  }

  console.log('--- Bundling with esbuild (CJS for SEA) ---');
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: bundleFile,
    format: 'cjs',
    alias: {
      '@playwright/test': 'playwright-core'
    },
    // Mocking require.resolve to avoid playwright-core looking for package.json
    banner: {
      js: `
const { createRequire } = require('module');
const path = require('path');
const require_ = createRequire(process.cwd() + '/index.js');
if (!require.resolve) {
  require.resolve = (id) => {
    if (id.includes('package.json')) return path.resolve(process.cwd(), 'package.json');
    try {
        return require_.resolve(id);
    } catch (e) {
        return id;
    }
  };
}
`
    },
    external: ['fsevents'],
  });

  console.log('--- Generating SEA preparation blob ---');
  const seaConfig = {
    main: bundleFile,
    output: blobFile,
    disableSentinel: false
  };
  writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));

  execSync(`node --experimental-sea-config sea-config.json`, { stdio: 'inherit' });

  console.log('--- Creating executable ---');
  copyFileSync(nodeExe, outputExePath);

  console.log('--- Injecting blob into executable ---');
  const postjectCmd = `npx postject ${outputExePath} NODE_SEA_BLOB ${blobFile} --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;

  execSync(postjectCmd, { stdio: 'inherit' });

  console.log(`Successfully created ${outputExePath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
