import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursively finds all markdown files in a directory, excluding node_modules and .git.
 */
function getMarkdownFiles(dir, allFiles = []) {
  const files = readdirSync(dir)
  for (const file of files) {
    if (file === 'node_modules' || file === '.git') continue
    const name = join(dir, file)
    try {
      if (statSync(name).isDirectory()) {
        getMarkdownFiles(name, allFiles)
      } else if (name.endsWith('.md')) {
        allFiles.push(name)
      }
    } catch (err) {
      // Handle cases where statSync might fail (e.g. broken symlinks)
      console.warn(`Warning: Could not access ${name}: ${err.message}`)
    }
  }
  return allFiles
}

console.log('Searching for markdown files with TOC placeholders...')

const allMdFiles = getMarkdownFiles('.')
const filesToUpdate = allMdFiles.filter((file) => {
  try {
    const content = readFileSync(file, 'utf8')
    return content.includes('<!-- toc -->')
  } catch (err) {
    console.warn(`Warning: Could not read ${file}: ${err.message}`)
    return false
  }
})

if (filesToUpdate.length === 0) {
  console.log('No markdown files with "<!-- toc -->" placeholder found.')
  process.exit(0)
}

console.log(`Found ${filesToUpdate.length} file(s) to update.`)

filesToUpdate.forEach((file) => {
  console.log(`Updating TOC for ${file}...`)
  try {
    // We use npx markdown-toc -i which updates the file in-place
    execSync(`npx markdown-toc -i ${file}`, { stdio: 'inherit' })
  } catch (error) {
    console.error(`Error updating TOC for ${file}:`, error.message)
  }
})

console.log('TOC update complete.')
