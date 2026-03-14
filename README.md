# Perplexity History Export Tool

A high-performance tool to export your Perplexity.ai conversation history to organized Markdown files, with support for semantic search and RAG (Retrieval-Augmented Generation) using local AI.

## Features

- **Parallel Scraping** – Uses Playwright to extract multiple conversations simultaneously for high speed.
- **Resilient to failures** – Automatically recreates browser context if it crashes; retries failed conversations.
- **RAG Search Mode** – Ask questions about your exported history using local LLMs (Ollama) and vector search (Vectra).
- **Semantic Search** – Find conversations based on meaning, not just keywords.
- **Checkpoint & Resumability** – Progress is saved frequently so you can resume after interruptions.
- **REPL-style CLI** – User-friendly interactive command-line interface.

---

## Requirements

- Node.js 20+
- [Ollama](https://ollama.ai) – For embeddings and RAG generation.
- [ripgrep](https://github.com/BurntSushi/ripgrep) (rg) – For exact text search.
- Playwright (installed via npm install).

### Ollama Setup

Pull the required models:

```bash
# For embeddings
ollama pull nomic-embed-text

# For RAG generation (default)
ollama pull deepseek-r1
```

---

## Installation

```bash
npm install
```

---

## Configuration

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

### Key Environment Variables

- OLLAMA_URL: URL where Ollama is running (default: http://localhost:11434).
- OLLAMA_MODEL: Model used for RAG generation (e.g., deepseek-r1).
- OLLAMA_EMBED_MODEL: Model used for creating vector embeddings (e.g., nomic-embed-text).
- ENABLE_VECTOR_SEARCH: Set to true to enable semantic search and RAG.

---

## Usage

Run the tool:

```bash
npm run dev
```

### Available Commands

- Start scraper (Library): Begins the export process. Authenticate manually in the browser window if prompted.
- Search conversations: Search through your exports. Choose between Auto, Semantic, RAG, or Exact modes.
- Build vector index: Processes your Markdown exports into a local vector database for search and RAG.
- Reset all data: Clears checkpoints, auth data, and the vector index.

---

## Testing

The project uses Vitest for testing, following the "Testing Trophy" philosophy with a strong emphasis on integration tests.

```bash
# Run unit tests
npm run test:unit

# Run integration tests (uses MSW for mocking Ollama)
npm run test:integration
```

---

## Project Structure

- src/ai/: Ollama client and RAG orchestration.
- src/scraper/: Playwright-based extraction logic and worker pool.
- src/search/: Vector store (Vectra) and ripgrep search.
- src/repl/: Interactive CLI components.
- src/utils/: Shared utilities like chunking and logging.

---

## Notes & Limitations

- Scraping speed depends on PARALLEL_WORKERS and RATE_LIMIT_MS settings in your .env.
- RAG performance depends on your local hardware and the chosen Ollama models.
