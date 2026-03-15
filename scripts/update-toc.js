import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['README.md', 'ARCH.md'];

files.forEach(file => {
  console.log(`Updating TOC for ${file}...`);
  try {
    execSync(`npx markdown-toc -i ${file}`);
  } catch (error) {
    console.error(`Error updating TOC for ${file}:`, error.message);
  }
});
