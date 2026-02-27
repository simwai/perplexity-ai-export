# Perplexity History Export

TypeScript + Playwright tool to bulk-export all your Perplexity.ai conversations, organize them by Space, and search them via ripgrep or local vector search (Ollama + Vectra).

## Features

- Manual login (normal or Google) with **persistent Playwright auth state**.
- Crawls your **Perplexity history/collections** via infinite scroll.
- Fetches conversation data via **network interception** (no fragile copy buttons).
- **Parallel export** with a worker pool for speed.
- One **Markdown file per conversation**, grouped into folders by Space.
- Resumable runs via **checkpoint** file with restart/resume choice.
- REPL-style CLI with **Inquirer autocomplete** (wizard flow).
- Search:
  - **Exact text** search via ripgrep.
  - **Semantic** search via Vectra + Ollama embeddings.

---

## Requirements

- Node.js 20+
- npm (or pnpm / yarn)
- Git (optional)
- Installed tools:
  - [Playwright](https://playwright.dev) (comes via `@playwright/test`)
  - [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`)
  - [Ollama](https://ollama.ai) with an embedding model (e.g. `nomic-embed-text`)

Install ripgrep:

- Windows: `choco install ripgrep` or `scoop install ripgrep`
- macOS: `brew install ripgrep`
- Debian/Ubuntu: `sudo apt install ripgrep`

Install Ollama and pull the embedding model:

```bash
ollama pull nomic-embed-text
```

---

## Installation

From the project root (where `package.json` is):

```bash
npm install
```

If you created the project with the provided PowerShell scaffold, you’re already in the right directory.

---

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Then adjust `.env` as needed:

```bash
# Auth persistence
AUTH_STORAGE_PATH=.storage/auth.json

# Scraping behavior
WAIT_MODE=dynamic           # dynamic | static
RATE_LIMIT_MS=500
PARALLEL_WORKERS=5
CHECKPOINT_SAVE_INTERVAL=10

# Vector search
ENABLE_VECTOR_SEARCH=true

# AI services
OLLAMA_URL=http://localhost:11435
OLLAMA_MODEL=deepseek-r1
OLLAMA_EMBED_MODEL=nomic-embed-text

# Paths
EXPORT_DIR=exports
CHECKPOINT_PATH=.storage/checkpoint.json
VECTOR_INDEX_PATH=.storage/vector-index
```

Notes:

- `WAIT_MODE=dynamic`: use Playwright’s built-in waits.
- `WAIT_MODE=static`: use manual `waitForTimeout` delays (more conservative).
- `PARALLEL_WORKERS`: number of Playwright contexts scraping in parallel.
- `ENABLE_VECTOR_SEARCH=false`: disables semantic search completely.

---

## Usage

Run the REPL:

```bash
npm run dev
```

You’ll see:

```text
🔮 Perplexity History Export Tool

perplexity>
```

Use arrows + typeahead to select commands.

### Command: start

1. Select `start` in the REPL.
2. First run:
   - A Playwright browser opens on `https://www.perplexity.ai/settings`.
   - Log in manually (normal or Google).
   - Confirm in the terminal when logged in.
   - Auth state is saved to `.storage/auth.json`.
3. Later runs:
   - Tool reuses saved auth.
   - If it detects you’re logged out, it will ask you to log in again and refresh the auth state.

If a checkpoint exists:

- You’ll be asked whether to:
  - **Resume** from checkpoint.
  - **Restart** from scratch.
  - **Cancel**.

Then the scraper:

1. **Phase 1: Discovery**
   - Opens `https://www.perplexity.ai/collections`.
   - Scrolls until no new items are loaded.
   - Collects metadata: URL, title, space name, timestamp.
2. **Phase 2: Parallel Extraction**
   - Spawns `PARALLEL_WORKERS` browser contexts.
   - Each worker:
     - Navigates to a conversation URL.
     - Intercepts the API response containing thread data.
     - Extracts messages and metadata.
     - Writes a Markdown file:
       - Folder: `exports/{SpaceName}/`
       - Filename: `{SpaceName}_{Title}_{Date}_{Id}.md`
   - Checkpoint updated every `CHECKPOINT_SAVE_INTERVAL` items.

### Command: vectorize

Builds (or rebuilds) the local vector index from all exported Markdown files.

Flow:

1. Prompts: “Rebuild the vector index from exports now?”
2. Validates Ollama embeddings:
   - If failure: shows error and offers to retry after you start Ollama.
3. Reads all `exports/**/*.md`.
4. Extracts metadata (title, Space, ID).
5. Embeds the full file content with Ollama.
6. Inserts into Vectra `LocalIndex` with metadata.
7. Saves index to `.storage/vector-index`.

Run it whenever:

- You add new exports.
- You change the embedding model.
- You reset the index.

### Command: search

Flow:

1. Select `search`.
2. Enter query (natural language or exact string).
3. Choose mode:
   - **Auto**: simple heuristic
     - Long queries → semantic
     - Short queries → exact text
   - **Semantic (Ollama + Vectra)**: vector search only.
   - **Exact text (ripgrep)**: `rg` search only.

Search modes:

- Exact (rg):
  - Runs `rg` inside `EXPORT_DIR`.
  - Prints colored, heading-based matches with line numbers.
- Semantic (vector):
  - Embeds query via Ollama.
  - Queries Vectra’s index with `(vector, queryString, topK)`.
  - Prints:
    - Space name
    - Title
    - Relevance score
    - File path

Example flows:

```text
perplexity> search
? Search query: typescript error handling patterns
? Search mode: Semantic (Ollama + Vectra)
...

perplexity> search
? Search query: "Playwright authState"
? Search mode: Exact text (ripgrep)
...
```

### Command: help

Shows available actions and short explanations.

### Command: exit

Quits the REPL.

---

## Project Structure

```text
src/
  index.ts                # Entry: start REPL
  utils/
    config.ts             # .env loading + Zod validation
    logger.ts             # Chalk-based logging
    wait-strategy.ts      # dynamic vs static waits for Playwright
  scraper/
    types.ts              # Conversation/checkpoint types
    browser.ts            # Playwright auth + context setup
    checkpoint-manager.ts # Load/save/resume checkpoint JSON
    url-discovery.ts      # Infinite scroll + URL collection
    conversation-extractor.ts # Network interception + JSON parse
    worker-pool.ts        # Parallel Playwright contexts
    rate-limiter.ts       # Global rate limiter between workers
  export/
    file-writer.ts        # Write Markdown by Space
    sanitizer.ts          # Safe filenames
  search/
    rg-search.ts          # ripgrep wrapper
    vector-store.ts       # Vectra + Ollama wrapper
    search-orchestrator.ts# Decide between rg/vector/auto
  ai/
    ollama-client.ts      # Embedding HTTP client
  repl/
    index.ts              # Inquirer-based wizard REPL
    commands.ts           # Command handlers for start/search/vectorize
    help.ts               # Help text
```

---

## Checkpoint & Resumability

Checkpoint file: `CHECKPOINT_PATH` (default `.storage/checkpoint.json`).

It stores:

- `discoveredConversations`: all discovered URLs + metadata.
- `processedUrls`: which URLs have already been exported.
- `discoveryCompleted`: whether Phase 1 finished.
- `totalProcessed`: stats.

On startup, `start` will:

- Detect existing checkpoint.
- Ask if you want to **resume** or **restart**.
- On resume:
  - Skips discovery if already completed.
  - Processes only pending URLs.
- On restart:
  - Clears checkpoint.
  - Runs discovery again and exports everything.

---

## Auth & Login

- Uses Playwright’s `storageState` JSON file to persist auth between runs. [playwright](https://playwright.dev/docs/auth)
- Supports:
  - Normal Perplexity login.
  - Google login (you perform it manually).
- Flow:
  - If no auth file exists:
    - Opens settings page.
    - You log in.
    - Confirms and saves storage state.
  - If auth file exists:
    - Loads state.
    - Checks if settings/history reachable.
    - If not, asks you to log in again and overwrites auth state.

---

## Vector Search Details

- **Embeddings**: via Ollama embedding endpoint (e.g. `nomic-embed-text`). [ollama](https://ollama.com/library/nomic-embed-text)
- **Index**: Vectra `LocalIndex` on disk, stored in `VECTOR_INDEX_PATH`. [github](https://github.com/Stevenic/vectra)
- We index:
  - Document text = entire Markdown file content.
  - Metadata: `{ id, path, title, spaceName }`.
- Query:
  - Embeds query string with Ollama.
  - Calls `LocalIndex.queryItems(embedding, query, topK, filter?, isBm25?)`. [app.unpkg](https://app.unpkg.com/vectra@0.12.3/files/src/LocalDocumentIndex.ts)
  - Ranks by similarity and returns metadata + score.

---

## Development

Type-check:

```bash
npm run type-check
```

Build:

```bash
npm run build
```

Run compiled:

```bash
npm start
```

---

## Notes & Limitations

- DOM selectors (`[data-testid="thread-item"]`, etc.) are based on current Perplexity UI; if they change, you may need to adjust them.
- Scraping a very large history can take time; adjust `PARALLEL_WORKERS` and `RATE_LIMIT_MS` based on stability.
- Vector search requires:
  - `ENABLE_VECTOR_SEARCH=true`
  - Ollama running and the embedding model pulled.
