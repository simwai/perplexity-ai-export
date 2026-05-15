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
  * [2. Install Ollama (Optional - For AI Intelligence)](#2-install-ollama-optional---for-ai-intelligence)
  * [3. Download and Prepare the Project](#3-download-and-prepare-the-project)
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

This tool is designed to externalize your Perplexity.ai conversation history into structured JSON archives suitable for canonical SQLite archival, full-text search, vector indexing, and downstream tools such as MyChatArchive/ITIR. Markdown and vector search remain available as optional sidecars for local reading and semantic exploration.

## Key Features

- **Parallelized Extraction**: Leverages Playwright to extract multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience**: Automatically restores browser contexts and retries operations, ensuring continuity amidst environmental instability.
- **Structured Archive Output**: Emits `itir.perplexity.thread.v1` JSON artifacts with normalized messages, stable source IDs, metadata, and captured API data for downstream SQLite/archive ingest.
- **Optional Markdown Sidecars**: Preserve the previous human-readable Markdown export path when `EXPORT_MARKDOWN=true`.
- **Optional RAG (Retrieval-Augmented Generation)**: Engage in a cognitive dialogue with your history when vector search is enabled.
- **Optional Semantic Vector Search**: Move beyond keyword matching with Markdown sidecars, Ollama, and Vectra enabled.
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
  1. Install `nvm` by following the instructions at [nvm.sh](https://nvm.sh).
  2. Run:
     ```bash
     nvm install 20
     nvm use 20
     ```

### 2. Install Ollama (Optional - For AI Intelligence)

Ollama is **optional**. It is only required if you want to use the Semantic Search or RAG (Retrieval-Augmented Generation) features. Basic extraction and keyword search work without it.

1. Download and install Ollama from [ollama.ai](https://ollama.ai).
2. Open your terminal and pull the required models:
   ```bash
   ollama pull nomic-embed-text
   ollama pull deepseek-r1
   ```

### 3. Download and Prepare the Project

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

- **HEADLESS**: Defaults to `false`. **Note:** Headless mode (`true`) is currently non-functional due to Cloudflare Turnstile protection on Perplexity.ai. Using headful mode allows you to complete any challenges manually if they appear.
- **OLLAMA_URL**: Access point for your local AI engine (default: http://localhost:11434).
- **OLLAMA_MODEL**: Cognitive model for RAG synthesis (e.g., deepseek-r1).
- **OLLAMA_EMBED_MODEL**: Model for generating vector representations (e.g., nomic-embed-text).
- **EXPORT_STRUCTURED_JSON**: Defaults to `true`. Writes canonical `itir.perplexity.thread.v1` JSON artifacts for downstream archive ingest.
- **STRUCTURED_EXPORT_DIR**: Defaults to `EXPORT_DIR`. Set this to separate canonical JSON archives from sidecar files.
- **EXPORT_MARKDOWN**: Defaults to `false`. Set to `true` to also write the previous Markdown files.
- **ENABLE_VECTOR_SEARCH**: Defaults to `false`. Set to `true` to activate semantic and RAG layers. Current vector indexing reads Markdown exports, so enable `EXPORT_MARKDOWN=true` before rebuilding the vector index.

## Usage Guide

Launch the system:

```bash
# Start the development environment
npm run dev
```

### Operational Directives

- **Start scraper (Library)**: Initiates extraction. Authenticate manually if required.
  - **Note**: Due to the complexity of Perplexity's API and potential network fluctuations, it may be necessary to **run the scraper multiple times** to ensure all conversations are fully gathered. The system uses checkpoints to resume where it left off.
- **Canonical archive**: The primary export is structured JSON. Treat Markdown and vector indexes as optional sidecars that can be regenerated from canonical thread/message records.
- **SQLite/MyChatArchive ingest**: After exporting, tools such as `chat-export-structurer` can ingest the structured JSON into a canonical SQLite archive:
  ```bash
  python src/ingest.py \
    --in /path/to/perplexity-ai-export/exports \
    --format perplexity \
    --account perplexity \
    --source-id perplexity_auto
  ```
- **Bundle downloaded Perplexity Markdown**: If Perplexity's API only returns the first page of a long thread, place the downloaded `.md` chunks in a local folder and run:
  ```bash
  npm run bundle:perplexity-downloads -- \
    --input /path/to/downloaded/perplexity-markdown \
    --title-prefix "Thread title prefix" \
    --thread-id "<perplexity-thread-uuid>" \
    --out exports-downloads/thread.download.itir.perplexity.json
  ```
  Then ingest that JSON with `chat-export-structurer --format perplexity --account perplexity` so the recovered turns attach to the same canonical Perplexity thread.
- **Search conversations**: Interface with your history using various modes:
  - **Auto**: Heuristic selection between semantic and exact search.
  - **Semantic**: Fuzzy matching via high-dimensional vector space.
  - **RAG**: Direct inquiry—e.g., "What did I learn about emergent intelligence?"
  - **Exact**: Rapid string matching via ripgrep (bundled).
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
