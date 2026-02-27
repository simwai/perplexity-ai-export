import chalk from 'chalk'

export function showHelp(): void {
  console.log(chalk.bold('\\n📚 Available Actions:\\n'))

  console.log(chalk.cyan('  start'))
  console.log('    Run the scraper. If a checkpoint exists, you can resume or restart.\\n')

  console.log(chalk.cyan('  search'))
  console.log('    Search exported conversations (choose mode: auto / semantic / exact).\\n')

  console.log(chalk.cyan('  vectorize'))
  console.log('    Build or rebuild the local vector index from exports using Ollama.\\n')

  console.log(chalk.cyan('  help'))
  console.log('    Show this help message.\\n')

  console.log(chalk.cyan('  exit'))
  console.log('    Exit the tool.\\n')

  console.log(chalk.bold('💡 Tips:\\n'))
  console.log('  • Use auto mode for natural language questions.')
  console.log('  • Use semantic search when you want fuzzy matches.')
  console.log('  • Use exact search for precise string matches.\\n')
}
