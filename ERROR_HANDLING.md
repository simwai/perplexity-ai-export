# 🏛️ Cognitive Resilience: The Error Handling Architecture

In the pursuit of seamless knowledge externalization, the system must not only anticipate failure but embrace it as a fundamental state of operational evolution. Our error handling strategy is not merely a collection of `try-catch` blocks; it is a **teleological framework** designed to maintain system integrity while providing granular observability into the cognitive flow of data extraction and RAG synthesis.

## The Philosophical Core: The Error Bus

At the center of our operational resilience lies the `ErrorBus` (`src/utils/error-bus.ts`). This is the central nervous system for exceptions, decoupled from the immediate call stack. By routing errors through a unified bus, we achieve a separation of concerns between the **detection** of an anomaly and its **reporting** or **resolution**.

- **Teleological Reporting**: Errors are not just "logged"; they are reported with intent, carrying metadata that describes their origin and impact on the broader knowledge graph.
- **Graceful Degradation**: The system is designed to favor partial success over total failure. Non-critical anomalies are reported via the bus without halting the primary execution flow.

## The Semantic Registry: ErrorMessages

To ensure clarity and consistency, every human-readable signal emitted by the system is managed within a centralized **Semantic Registry** (`src/utils/error-messages.ts`). This approach eliminates hardcoded entropy and facilitates a unified voice for system-to-human communication.

### Patterns of Engagement

#### 1. Deterministic Rethrowing (`raise`)
When a component encounters an unrecoverable state, it uses `errorBus.raise`. This pattern ensures that the error is both recorded by the system's observability layer and propagated to the caller with a semantically rich context.

```typescript
throw errorBus.raise(
  Scraper.ExtractionError,
  ErrorMessages.Scraper.Extraction.ApiTimeout,
  originalError
)
```

#### 2. Non-HALT Reporting (`report`)
For non-fatal perturbations—such as a failed AI fact extraction that can be mitigated by raw snippet fallback—we use `errorBus.report`. This allows the system to continue its cognitive task while ensuring the anomaly is documented.

```typescript
errorBus.report(error, { message: ErrorMessages.Rag.FactExtractionFailed })
```

## Modular Error Domains

Errors are categorized into discrete domains, reflecting the modular nature of our architecture:

- **Ollama**: Perturbations in the local AI intelligence layer.
- **Search**: Failures in semantic vectorization or ripgrep execution.
- **Scraper**: Anomalies in the browser orchestration and data extraction flow.
- **Checkpoint**: Integrity failures in the persistent state management system.
- **Rag**: Breakdowns in the adaptive hybrid search and synthesis logic.

## Operational Observability

The `logger` (`src/utils/logger.ts`) serves as the primary interface for human observation. It subscribes to the `ErrorBus`, ensuring that every reported error is presented with the appropriate level of urgency and detail, including full stack traces for technical introspection.

---
*For a deeper dive into the system's structural logic, refer to [ARCH.md](./ARCH.md).*
