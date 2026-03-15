# Contributing to Perplexity History Export

We welcome contributions! To ensure a smooth development process and maintain high code quality, please follow these guidelines.

## Development Environment Setup

1. **Install Node.js**: Ensure you have Node.js 20+ installed.
2. **Install Ollama**:
  - Download and install [Ollama](https://ollama.ai/).
  - \`ollama pull nomic-embed-text\` (for semantic vectors)
  - \`ollama pull cogito\` (for generative synthesis)
  - \`ollama pull ministral-3\` (for vision-based bypass)
3. **Install Dependencies**:
  \`\`\`bash
  npm install
  \`\`\`
4. **Prepare Environment Variables**:
  \`\`\`bash
  cp .env.example .env
  \`\`\`
5. **Install Playwright Browsers**:
  \`\`\`bash
  npx playwright install chromium
  \`\`\`

## Development Workflow

- **Start in Dev Mode**:
  \`\`\`bash
  npm run dev
  \`\`\`
- **Type Checking**:
  \`\`\`bash
  npm run type-check
  \`\`\`
- **Formatting & Linting**:
  \`\`\`bash
  npm run format
  \`\`\`

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/).

- \`feat:\` for new features.
- \`fix:\` for bug fixes.
- \`docs:\` for documentation changes.
- \`chore:\` for maintenance tasks.

## Testing Strategy

- **Unit Tests**: Place in \`test/unit/\`.
- **Integration Tests**: Place in \`test/integration/\`.
- **Run all tests**:
  \`\`\`bash
  npm test
  \`\`\`

## Pull Request Process

1. Create a feature branch.
2. Ensure all tests pass.
3. Submit the PR with a clear description of the changes.

## Build Single Executable (SEA)

To build the standalone executable for your platform:

\`\`\`bash
npm run build:exe
\`\`\`
