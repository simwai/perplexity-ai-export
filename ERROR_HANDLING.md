# Robust Error Handling & Diagnostic Resilience

This document outlines the philosophical and technical approach to error management within the Perplexity History Export tool. We prioritize diagnostic clarity and context preservation to ensure that environmental instability does not lead to information entropy.

---

<!-- toc -->

- [1. The Philosophy of Error Preservation](#1-the-philosophy-of-error-preservation)
- [2. Error Chaining & The `cause` Property](#2-error-chaining--the-cause-property)
- [3. High-Fidelity Diagnostics (Logging)](#3-high-fidelity-diagnostics-logging)
- [4. Architectural Resilience Patterns](#4-architectural-resilience-patterns)
  - [Context Restoration](#context-restoration)
  - [Safe Template Literals](#safe-template-literals)

<!-- tocstop -->

---

## 1. The Philosophy of Error Preservation

In a system as complex as distributed browser automation and RAG synthesis, errors are not merely exceptions to be silenced; they are data points. Our system adheres to the principle of **Maximum Context Retention**: every caught exception must carry its original lineage forward.

## 2. Error Chaining & The `cause` Property

We utilize native TypeScript/JavaScript error options to implement deep error chaining. Custom error classes (e.g., `ExtractionError`, `VectorStoreError`) are designed to accept an optional `cause` in their constructors.

```typescript
try {
  await operation()
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  throw new CustomError(`Failed to execute operation: ${errorMessage}`, { cause: error })
}
```

This pattern ensures that the original stack trace and specific error details (like network timeouts or selector failures) remain accessible to the root diagnostic layer.

## 3. High-Fidelity Diagnostics (Logging)

Our `logger` is engineered to be more than a `console.log` wrapper. When an error object is passed to the logger, it utilizes `node:util.inspect` with infinite depth to render a colorized, full-context representation of the error tree.

- **Success/Info**: Standard operational feedback.
- **Warnings**: Signal non-fatal inconsistencies (e.g., API response timeouts or missing metadata).
- **Errors**: Render the primary error message alongside the entire nested `cause` chain and stack traces.

## 4. Architectural Resilience Patterns

### Context Restoration

The `WorkerPool` and `BrowserManager` implement organic resilience patterns. If a browser context dies (Target closed, Protocol error), the system detects this at the worker level, triggers a shared context recreation, and retries the operation without human intervention.

### Safe Template Literals

To maintain clean code and prevent logical fragmentation, we avoid complex type-checking logic (like `instanceof`) inside template literals. Error messages are pre-extracted into local variables to ensure that the logging strings remain declarative and readable.

```typescript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error(`Operation failed: ${errorMessage}`, error);
}
```
