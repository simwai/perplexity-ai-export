# Contributing to the Evolution of Perplexity History Export

Welcome, seeker of organized intelligence. We are delighted that you've chosen to contribute your cognitive energy to this system. By refining this tool, we collectively enhance our ability to synthesize knowledge from our digital interactions.

This project is a manifestation of structured data extraction and semantic synthesis. To maintain the integrity of its cognitive architecture, we follow a specific workflow.

---

## Prerequisites for Co-Creation

To effectively interact with the codebase, your local environment must support the following substrates:

- **Node.js 20+**: The fundamental runtime for our operations.
- **Ollama**: Essential for local embedding generation and RAG-based reasoning.
  - `ollama pull nomic-embed-text` (for semantic vectors)
  - `ollama pull deepseek-r1` (for generative synthesis)
- **ripgrep (rg)**: Required for high-velocity exact pattern matching.
- **Playwright**: Our interface for navigating the complexities of the web.

---

## The Developmental Lifecycle

### 1. Initialization

Clone the repository and instantiate the dependencies:

```bash
npm install
npx playwright install chromium
```

### 2. Environment Configuration

Establish your local parameters:

```bash
cp .env.example .env
# Refine the variables to align with your local Ollama setup.
```

### 3. Iterative Development

Launch the interactive environment to observe the system in action:

```bash
npm run dev
```

### 4. Integrity Verification (Testing)

We adhere to a "Testing Trophy" philosophy, prioritizing integration tests that verify the emergent behavior of system components.

- **Unit Tests**: `npm run test:unit`
- **Integration Tests**: `npm run test:integration` (Uses MSW to simulate Ollama interactions)
- **End-to-End**: `npm run test:e2e`

Always ensure the full suite passes before proposing a merger:

```bash
npm run test
```

### 5. Syntactic Harmony (Formatting)

We utilize `oxlint` and `oxfmt` for rapid, high-performance code analysis and formatting. Maintain the aesthetic and structural consistency of the codebase:

```bash
npm run format
```

---

## Proposing Cognitive Enhancements (PR Process)

1. **Fork and Branch**: Create a branch with a descriptive prefix:
   - `feat/` for novel capabilities.
   - `fix/` for rectifying systemic discrepancies (bugs).
   - `docs/` for enhancing the conceptual clarity of our documentation.
2. **Commit with Intent**: Write clear, descriptive commit messages.
3. **Synergize**: Open a Pull Request. Provide a concise summary of the changes and how they contribute to the system's overall utility.

---

## Ethical and Intellectual Standards

- **Clarity over Complexity**: While our goals are ambitious, our code should remain a model of lucidity.
- **Robustness**: Build for resilience against the unpredictable nature of web interfaces and AI model outputs.

Together, we are building a more coherent interface between human inquiry and machine intelligence.
