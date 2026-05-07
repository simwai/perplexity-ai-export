# Error Handling Refactor Plan & Progress Checklist

## 🎯 Objectives

- **Standardize**: Use custom error classes consistently across the codebase.
- **Preserve**: Ensure the original error object (and its stack trace) is never lost.
- **Simplify**: Use a centralized Error Bus (Pub/Sub) to decouple logic from logging.
- **Visible**: Enhance the logger to display colorized, deep-inspect error trees.

## 🛠 Architectural Pattern: Error Bus

We are implementing a Martin Fowler-inspired **Error Bus** (`src/utils/error-bus.ts`) where components report inconsistencies or raise fatal errors. The `logger` is a primary subscriber.

## 📋 Implementation Checklist

### Core Infrastructure

- [x] Implement `src/utils/error-bus.ts`
- [x] Subscribe `logger` to `errorBus` in `src/utils/logger.ts`
- [x] Enhance `logger.error` with `node:util.inspect`

### Refactor Batch 1: Core Synthesis & Search

- [x] `src/search/search-orchestrator.ts`
- [x] `src/search/vector-store.ts`
- [x] `src/ai/ollama-client.ts`
- [x] `src/ai/rag-orchestrator.ts`

### Refactor Batch 2: Extraction Engine

- [ ] `src/scraper/conversation-extractor.ts`
- [ ] `src/scraper/worker-pool.ts`
- [ ] `src/scraper/browser.ts`
- [ ] `src/scraper/checkpoint-manager.ts`
- [ ] `src/scraper/library-discovery.ts`

### Refactor Batch 3: CLI & Utilities

- [ ] `src/repl/commands.ts`
- [ ] `src/repl/index.ts`
- [ ] `src/export/file-writer.ts`
- [ ] `src/index.ts`

## 🚀 Batch 1 Status

**Complete**. Core search and AI layers now utilize the Error Bus for all exception handling.
