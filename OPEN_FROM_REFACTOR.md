# Open issues from refactoring

- **`src/ai/cross-encoder.ts` (Lines 1-80)**
  - *Architectural Flaw / Dead Code*: `CrossEncoderReranker` / `getCrossEncoder` in `cross-encoder.ts` provides a stub class instance wrapper while `RagRetriever` (`src/ai/rag-retriever.ts`) executes cross-encoder reranking directly via its own tokenizer and model invocations. `cross-encoder.ts` could be consolidated directly into `rag-retriever.ts` to reduce unused abstractions.

- **`src/scraper/worker-pool.ts` (Lines 75-80)**
  - *Logical Bug / Concurrency Handling*: In `processConversations`, task promises are created and pushed to `activeTasks`, but `await task` inside the synchronous queue loop blocks sequential scheduling rather than executing tasks in true parallel worker concurrency.
