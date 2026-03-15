<p align="center">
  <img src="docs/header.svg" width="100%" alt="Perplexity History Export Header" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-4c1d95?style=flat&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5b21b6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Ollama-6d28d9?style=flat&logo=ollama&logoColor=white" alt="Ollama" />
  <img src="https://img.shields.io/badge/Playwright-7c3aed?style=flat&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Vitest-8b5cf6?style=flat&logo=vitest&logoColor=white" alt="Vitest" />
</p>

---

<!-- toc -->

- [Introduction](#introduction)
- [Key Features](#key-features)
- [Environment Setup Guide](#environment-setup-guide)
  * [1. Install Node.js (The Engine)](#1-install-nodejs-the-engine)
  * [2. Install ripgrep (The Search Engine)](#2-install-ripgrep-the-search-engine)
  * [3. Install Ollama (The AI Intelligence)](#3-install-ollama-the-ai-intelligence)
  * [4. Download and Prepare the Project](#4-download-and-prepare-the-project)
- [Configuration](#configuration)
  * [Key Environment Variables](#key-environment-variables)
- [Usage Guide](#usage-guide)
  * [Operational Directives](#operational-directives)
- [RAG Capabilities](#rag-capabilities)
- [Architecture & Deep Dive](#architecture--deep-dive)
  * [Project Structure](#project-structure)
- [Testing](#testing)

<!-- tocstop -->

---

## Introduction

This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files. It facilitates the emergence of a personal knowledge base powered by local AI, bridging the gap between ephemeral inquiry and structured knowledge.

## Key Features

- **Parallelized Extraction**: Leverages Playwright to extract multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience**: Automatically restores browser contexts and retries operations, ensuring continuity amidst environmental instability.
- **Advanced RAG (Retrieval-Augmented Generation)**: Engage in a cognitive dialogue with your history. The system employs intent analysis to synthesize broad summaries or pinpoint specific technical insights.
- **Semantic Vector Search**: Move beyond keyword matching. Locate information based on conceptual depth and semantic relevance.
- **Persistent State Tracking**: Frequent checkpoints allow the system to resume progress after any interruption.
- **Interactive Synthesis (REPL)**: A streamlined command-line interface for human-system synergy.

## Environment Setup Guide

If you are new to development or don't have the necessary tools installed, follow these steps to set up your environment.

### 1. Install Node.js (The Engine)

We recommend using a version manager to install Node.js. This allows you to easily switch versions and avoids permission issues.

- **Windows**:
  1. Download and run the latest installer from [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
  2. Open a new Command Prompt or PowerShell and run:
     ```cmd
     nvm install 20
     nvm use 20
     ```
- **macOS / Linux**:
  1. Install `nvm` by following the instructions at [nvm.sh](https://github.com/nvm-sh/nvm).
  2. Run:
     ```bash
     nvm install 20
     nvm use 20
     ```

### 2. Install ripgrep (The Search Engine)

`ripgrep` (rg) is used for high-speed exact matching.

- **Windows**: Open PowerShell and run:
  ```powershell
  winget install BurntSushi.ripgrep
  ```
- **macOS**: Use [Homebrew](https://brew.sh/):
  ```bash
  brew install ripgrep
  ```
- **Linux**: Use your package manager (e.g., `sudo apt install ripgrep`).

### 3. Install Ollama (The AI Intelligence)

1. Download and install Ollama from [ollama.ai](https://ollama.ai).
2. Open your terminal and pull the required models:
   ```bash
   ollama pull nomic-embed-text
   ollama pull deepseek-r1
   ```

### 4. Download and Prepare the Project

If you don't have the `git` command installed, you can simply download this project as a ZIP file from GitHub and extract it.

Once extracted, open your terminal in the project folder and run:
```bash
npm install
npx playwright install chromium
```

## Configuration

Establish your environment by duplicating the template:

```bash
cp .env.example .env
```

### Key Environment Variables

- **OLLAMA_URL**: Access point for your local AI engine (default: http://localhost:11434).
- **OLLAMA_MODEL**: Cognitive model for RAG synthesis (e.g., deepseek-r1).
- **OLLAMA_EMBED_MODEL**: Model for generating vector representations (e.g., nomic-embed-text).
- **ENABLE_VECTOR_SEARCH**: Set to `true` to activate semantic and RAG layers.

## Usage Guide

Launch the system:

```bash
# Start the development environment
npm run d\
ev
```

### Operational Directives

- **Start scraper (Library)**: Initiates extraction. Authenticate manually if required.
- **Search conversations**: Interface with your history using various modes:
  - **Auto**: Heuristic selection between semantic and exact search.
  - **Semantic**: Fuzzy matching via high-dimensional vector space.
  - **RAG**: Direct inquiry—e.g., "What did I learn about emergent intelligence?"
  - **Exact**: Rapid string matching via ripgrep.
- **Build vector index**: Processes Markdown exports into a local vector store.
- **Reset all data**: Purges checkpoints, authentication data, and the vector index.

## RAG Capabilities

The RAG modality is engineered for various levels of cognitive inquiry:

- **Broad Synthesis**: "Summarize all threads regarding distributed systems."
- **Granular Retrieval**: "Locate the specific TypeScript pattern I used for the worker pool."
- **Cross-Thread Integration**: "How has my conceptual understanding of React hooks shifted?"

## Architecture & Deep Dive

For a detailed look at our RAG implementation, hybrid search strategy, and theoretical foundations, please refer to:

👉 **[ARCH.md](./ARCH.md)**

### Project Structure

- **src/ai/**: Ollama interaction and advanced RAG orchestration layers.
- **src/scraper/**: Playwright-based extraction logic and parallel worker pool management.
- **src/search/**: Vector storage (Vectra) and ripgrep search implementation.
- **src/repl/**: Interactive CLI components.
- **src/utils/**: Shared utility functions for data chunking and logging.

## Testing

We prioritize a "Testing Trophy" architecture, emphasizing integration tests.

```bash
# Execute unit-level verifications
npm run test:unit

# Execute integration-level verifications
npm run test:integration
```
