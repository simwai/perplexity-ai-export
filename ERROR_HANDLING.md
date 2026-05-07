# Simplified Error Reporting & Diagnostic Resilience

This document outlines the architectural shift from deep error chaining to a centralized, Pub/Sub-based error reporting model within the Perplexity History Export tool. We prioritize diagnostic visibility while maintaining a lean, decoupled codebase.

---

<!-- toc -->

- [1. The Error Bus Architecture](#1-the-error-bus-architecture)
- [2. Reporting vs. Raising](#2-reporting-vs-raising)
  - [Reporting (Non-Fatal)](#reporting-non-fatal)
  - [Raising (Fatal/Custom)](#raising-fatalcustom)
- [3. High-Fidelity Diagnostics (Logger Subscription)](#3-high-fidelity-diagnostics-logger-subscription)
- [4. Developer Directives](#4-developer-directives)

<!-- tocstop -->

---

## 1. The Error Bus Architecture

Our system employs a centralized **Error Bus** (`src/utils/error-bus.ts`) based on the Martin Fowler Pub/Sub pattern. Instead of tightly coupling every component to the logger or manually passing `cause` objects through multiple layers, components emit error events to the bus.

This decoupling allows the core logic to remain focused on its operational directives while the diagnostic layer (the logger) handles the complexity of formatting and output.

## 2. Reporting vs. Raising

We utilize two primary patterns for error management:

### Reporting (Non-Fatal)

Used when an error occurs but should not halt the entire process (e.g., a non-critical metadata parsing failure).

```typescript
} catch (error) {
  errorBus.report(error, { message: 'Failed to parse metadata' });
}
```

### Raising (Fatal/Custom)

Used when an error must be re-thrown as a specific custom type. The `raise` helper handles both the event emission and the creation of the custom error instance.

```typescript
} catch (error) {
  throw errorBus.raise(VectorStore.SearchError, 'Vector search failed', error);
}
```

## 3. High-Fidelity Diagnostics (Logger Subscription)

The `logger` is a subscriber to the `errorBus`. When an error is reported or raised:

1. The Error Bus captures the original error object and any optional metadata (like the custom error class name).
2. The Logger receives the event and utilizes `node:util.inspect` with infinite depth.
3. A colorized, full-context representation (including stack traces) is rendered to the console.

## 4. Developer Directives

- **Rename Catch Variables**: Always use `error` in catch blocks (e.g., `catch (error)`).
- **Avoid Inline Logic**: Do not perform `instanceof` checks or manual string formatting inside template literals.
- **Utilize the Bus**: Prefer `errorBus.raise` or `errorBus.report` over direct `logger.error` calls inside catch blocks to ensure the diagnostic layer receives the full error context.
