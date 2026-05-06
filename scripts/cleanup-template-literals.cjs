const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const files = execSync('grep -r -l "instanceof Error ?" src').toString().trim().split('\n')

files.forEach((filePath) => {
  let content = fs.readFileSync(filePath, 'utf8')

  const lines = content.split('\n')
  const newLines = []
  let changed = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('${error instanceof Error ? error.message : String(error)}')) {
      changed = true
      const indent = line.match(/^\s*/)[0]
      // Find the line before this one to see if it's a catch block or a throw
      newLines.push(
        `${indent}const errorMessage = error instanceof Error ? error.message : String(error)`
      )
      newLines.push(
        line.replace(
          /\${error instanceof Error \? error\.message : String\(error\)}/g,
          '${errorMessage}'
        )
      )
    } else {
      newLines.push(line)
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, newLines.join('\n'))
  }
})
