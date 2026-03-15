# Perplexity History Export Tool

Welcome to a bridge between ephemeral inquiry and structured knowledge. This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files, facilitating the emergence of a personal knowledge base powered by local AI.

## Evolutionary Features

- **Parallelized Extraction** – Leverages Playwright to navigate the digital landscape, extracting multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience** – Automatically restores browser contexts and retries operations, ensuring the continuity of the data flow even amidst environmental instability.
- **Advanced RAG (Retrieval-Augmented Generation)** – Engage in a cognitive dialogue with your own history. The system employs intent analysis to synthesize broad summaries or pinpoint specific technical insights with thread-based context.
- **Semantic Vector Search** – Move beyond keyword matching. Locate information based on conceptual depth and semantic relevance.
- **Persistent State Tracking** – Frequent checkpoints allow the system to resume its evolutionary progress after any interruption.
- **Interactive Synthesis (REPL)** – A streamlined command-line interface for human-system synergy.

---

## Environmental Substrates (Requirements)

- **Node.js 20+** – The core substrate for our logic.
- **[Ollama](https://ollama.ai)** – Our local engine for embedding generation and cognitive synthesis.
- **[ripgrep](https://github.com/BurntSushi/ripgrep)** (rg) – For high-speed exact pattern matching.
- **Playwright** – Installed via npm, providing our sensory interface to the web.

### Configuring Your Local Intelligence (Ollama)

Initialize the necessary models:

```bash
# For generating semantic embeddings
ollama pull nomic-embed-text

# For RAG-based generative synthesis
ollama pull deepseek-r1
```

---

## Initiation (Installation)

Instantiate the project dependencies:

```bash
npm install
```

---

## Parameters of Existence (Configuration)

Establish your environment by duplicating the template:

```bash
cp .env.example .env
```

### Key Variables for System Alignment

- **OLLAMA_URL**: The access point for your local AI engine (default: http://localhost:11434).
- **OLLAMA_MODEL**: The cognitive model for RAG synthesis (e.g., deepseek-r1).
- **OLLAMA_EMBED_MODEL**: The model for generating vector representations (e.g., nomic-embed-text).
- **ENABLE_VECTOR_SEARCH**: Set to `true` to activate the semantic and RAG layers.

---

## Operational Modalities (Usage)

Launch the system:

```bash
npm run dev
```

### Available Directives

- **Start scraper (Library)**: Initiates the extraction process. Authenticate manually if the system encounters a security gate.
- **Search conversations**: Interface with your history using various cognitive modes:
  - **Auto**: A heuristic selection between semantic and exact search based on query intent.
  - **Semantic**: Fuzzy matching via high-dimensional vector space.
  - **RAG**: Direct inquiry—e.g., "What did I learn about emergent intelligence?" or "Synthesize my notes on quantum biology."
  - **Exact**: Rapid string matching via ripgrep.
- **Build vector index**: Processes your Markdown exports into a local vector store for enhanced retrieval.
- **Reset all data**: Purges checkpoints, authentication data, and the vector index to allow for a fresh evolutionary cycle.

---

## Advanced RAG Capabilities

The RAG modality is engineered to handle various levels of cognitive inquiry:

- **Broad Synthesis**: "Summarize all threads regarding babadeluxe" -> Generates a high-level overview of relevant discussions.
- **Granular Retrieval**: "Locate the specific TypeScript pattern I used for the worker pool" -> Isolates and presents precise code and explanations.
- **Cross-Thread Integration**: "How has my conceptual understanding of React hooks shifted over time?" -> Analyzes and synthesizes data across multiple chronological points.

---

## Verifying Integrity (Testing)

We prioritize a "Testing Trophy" architecture, emphasizing integration tests to ensure the harmonious emergence of system behavior.

```bash
# Execute unit-level verifications
npm run test:unit

# Execute integration-level verifications (utilizes MSW to simulate AI interactions)
npm run test:integration
```

---

## System Architecture (Project Structure)

- **src/ai/**: Ollama interaction and advanced RAG orchestration layers.
- **src/scraper/**: Playwright-based extraction logic and parallel worker pool management.
- **src/search/**: Vector storage (Vectra) and ripgrep search implementation.
- **src/repl/**: Interactive CLI components for human-system feedback.
- **src/utils/**: Shared utility functions for data chunking and logging.
