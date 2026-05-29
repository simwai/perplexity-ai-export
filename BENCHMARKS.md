# Benchmarking the RAG Pipeline

This document describes how the benchmark system works, which metrics it captures, why those metrics were chosen, and how to interpret and extend the results.

---

<!-- toc -->

- [1. Overview](#1-overview)
- [2. How to Run](#2-how-to-run)
- [3. What Gets Measured](#3-what-gets-measured)
- [4. The Default Query Set](#4-the-default-query-set)
  - [Why These Queries?](#why-these-queries)
- [5. How Each Benchmark Works](#5-how-each-benchmark-works)
  - [End-to-End Latency](#end-to-end-latency)
  - [Success Rate](#success-rate)
  - [Per-Query Breakdown](#per-query-breakdown)
- [6. Why We Chose These Metrics](#6-why-we-chose-these-metrics)
- [7. What Is Not Measured (and Why)](#7-what-is-not-measured-and-why)
- [8. Customizing the Benchmark](#8-customizing-the-benchmark)
- [9. Interpreting Results](#9-interpreting-results)

<!-- tocstop -->

---

## 1. Overview

The benchmark system is a **latency and reliability stress test** for the full RAG pipeline. It fires a set of realistic queries end-to-end (through HyDE generation, hybrid search, cross-encoder reranking, MapReduce fact extraction, and final synthesis) and reports how long each stage takes and whether it completes without error.

The goal is to give you a single command that answers: _"Is the pipeline fast and stable on my machine, with my data?"_

---

## 2. How to Run

```bash
# Requires: built vector index + running Ollama instance
npm run benchmark
```

The benchmark will fail early with a clear error if the vector index has not been built yet. Run **Build vector index** from the main menu first.

---

## 3. What Gets Measured

| Metric                   | Unit        | Description                                                                                      |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------ |
| **Per-query latency**    | ms          | Wall-clock time from query submission to final synthesized answer, including all pipeline stages |
| **Average latency**      | ms          | Mean across all successful queries                                                               |
| **Success rate**         | `n / total` | How many queries completed without throwing an error                                             |
| **Per-query error flag** | boolean     | Whether a specific query caused a pipeline failure (logged separately with `DEBUG=true`)         |

All timing uses Node.js `performance.now()`, which provides monotonic, sub-millisecond resolution, unaffected by system clock adjustments.

---

## 4. The Default Query Set

The five default queries are intentionally broad and representative of real usage patterns:

```
1. What TypeScript patterns have I used in past projects?
2. Which npm packages have I discussed installing?
3. What errors or bugs did I troubleshoot recently?
4. What AI models or tools have I researched?
5. What architecture decisions did I make?
```

### Why These Queries?

Each query stress-tests a different retrieval challenge:

| Query                  | What it tests                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TypeScript patterns    | **Semantic clustering**: Many loosely related entries; tests whether the vector search can group conceptually similar content |
| npm packages           | **Entity extraction**: Specific proper nouns and version numbers; tests exact-match (ripgrep) fallback                        |
| Errors and bugs        | **Temporal vagueness**: "recently" has no hard boundary; tests how the planner handles underspecified time ranges             |
| AI models / tools      | **Broad taxonomy**: Many valid answers across unrelated threads; tests exhaustive-mode recall and MapReduce aggregation       |
| Architecture decisions | **Cross-thread synthesis**: Relevant content is spread across many separate conversations; the hardest query for the pipeline |

Together they cover the main failure modes: missed recall, entity blindness, planning ambiguity, context overload, and cross-thread reasoning.

---

## 5. How Each Benchmark Works

### End-to-End Latency

The timer starts immediately before `orchestrator.answerQuestion(query)` is called and stops when it resolves. This captures the **full pipeline cost**:

```
HyDE generation (LLM call)
  → Hybrid search (vector + ripgrep)
  → RRF fusion
  → Cross-encoder reranking (ONNX inference)
  → MapReduce fact extraction (LLM batch calls)
  → Final synthesis (LLM call)
```

No stages are skipped or mocked. The benchmark runs the exact same code path as interactive usage.

### Success Rate

Any uncaught exception during a query is caught, flagged as `error: true`, and the benchmark continues with the next query. This means a single failing query does not abort the entire run, and the final report shows exactly which queries failed and which succeeded.

### Per-Query Breakdown

After all queries complete, results are printed in order with a ✓/✗ status, latency in ms, and the query text. This makes it easy to spot outliers at a glance:

```
✓ [1] 3421ms: What TypeScript patterns have I used in past projects?
✓ [2] 2187ms: Which npm packages have I discussed installing?
✗ [3] 891ms: What errors or bugs did I troubleshoot recently?
✓ [4] 4102ms: What AI models or tools have I researched?
✓ [5] 5340ms: What architecture decisions did I make?

Successful: 4/5
Average latency: 3763ms
```

---

## 6. Why We Chose These Metrics

**Latency over throughput.** This is a personal, interactive REPL tool, not a server. A user waits for one query at a time. Average latency directly maps to perceived quality of experience. Throughput (queries per second) is irrelevant here.

**End-to-end over stage-level.** Micro-benchmarking individual stages (e.g., just vector search or just reranking) tells you how fast components are in isolation, but not how they compose under real conditions. LLM call times vary based on prompt length, context, and Ollama scheduling. Only end-to-end timing reflects what users actually experience.

**Success rate over quality scoring.** Evaluating answer quality requires a ground-truth dataset and human judgement. Neither of which can be assumed to exist for a personal knowledge base with unique content. Success rate is objective, automatable, and still meaningful: a pipeline that errors out on 2/5 queries has a real problem regardless of how good the other 3 answers are.

**Per-query granularity.** Aggregate averages hide outliers. A 3000ms average could mean five consistent 3s queries, or one 11s query masking four fast ones. The per-query breakdown exposes which specific queries are slow or failing, pointing directly to the pipeline stage most likely responsible.

---

## 7. What Is Not Measured (and Why)

| Not measured                   | Reason                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Answer quality / relevance** | Requires ground-truth annotations tied to specific personal history data; not portable across users       |
| **Recall@K / MRR / NDCG**      | Standard IR metrics that require labelled relevance judgements; same portability problem                  |
| **Stage-level latency**        | Useful for profiling but adds instrumentation complexity with minimal actionable benefit for end users    |
| **Memory usage**               | Ollama model memory dominates and is outside the process boundary; Node.js heap alone is misleading       |
| **Cold vs. warm start**        | ONNX model and Ollama context warming are one-time startup costs, not per-query costs after the first run |

---

## 8. Customizing the Benchmark

Edit the `BENCHMARK_QUERIES` array at the top of `src/benchmark.ts`:

```ts
const BENCHMARK_QUERIES = [
  'What TypeScript patterns have I used in past projects?',
  // Add your own questions here. The more specific to your
  // actual history, the more meaningful the latency numbers.
  'What did I discuss about Docker networking?',
  'Which Python libraries have I mentioned?',
]
```

**Tips for writing good benchmark queries:**

- Use questions you actually ask in the REPL. Benchmark queries that don't reflect real usage give misleading signal.
- Mix broad questions ("What AI tools have I researched?") with specific ones ("What did I say about Vite config?") to exercise both `exhaustive` and `precise` pipeline modes.
- Include at least one question you _know_ has no good answer in your history. This tests graceful degradation rather than just the happy path.
- Run the benchmark before and after any pipeline change to validate that latency did not regress.

---

## 9. Interpreting Results

| Observation                              | Likely cause                                             | What to check                                        |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| All queries > 10s                        | Ollama model too large for available RAM                 | Try a smaller model (e.g. `mistral` vs `llama3:70b`) |
| One query consistently slow              | Query triggers exhaustive mode + large MapReduce batches | Check planner output with `DEBUG=true`               |
| Latency spikes on first query only       | ONNX model cold-load + Ollama KV cache miss              | Normal: ignore first-run outlier                     |
| Failures on specific queries             | Planner or synthesis LLM call timeout                    | Check Ollama process health; run with `DEBUG=true`   |
| Average latency increased after a change | Regression in pool size, reranker, or prompt length      | Diff the change against the baseline run             |
