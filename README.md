<p align="center">
  <img src="docs/header.svg" width="100%" alt="Perplexity History Export Header" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-4c1d95?style=flat&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5b21b6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Ollama-6d28d9?style=flat&logo=ollama&logoColor=white" alt="Ollama" />
  <img src="https://img.shields.io/badge/Patchright-7c3aed?style=flat&logo=playwright&logoColor=white" alt="Patchright" />
  <img src="https://img.shields.io/badge/Vitest-8b5cf6?style=flat&logo=vitest&logoColor=white" alt="Vitest" />
</p>

---

<!-- toc -->

- [Introduction](#introduction)
- [Stealth & Behavioral Resilience](#stealth--behavioral-resilience)
- [Key Features](#key-features)
- [Stealth & Resilience](#stealth--resilience)
- [Environment Setup Guide](#environment-setup-guide)
  * [1. Install Node.js (The Engine)](#1-install-nodejs-the-engine)
  * [2. Install Ollama (The AI Intelligence)](#2-install-ollama-the-ai-intelligence)
  * [3. Download and Prepare the Project](#3-download-and-prepare-the-project)
- [Configuration](#configuration)
  * [Key Environment Variables](#key-environment-variables)
- [Usage Guide](#usage-guide)
- [RAG Capabilities](#rag-capabilities)
- [Architecture & Deep Dive](#architecture--deep-dive)
- [Testing](#testing)

<!-- tocstop -->

---

## Introduction

This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files. It facilitates the emergence of a personal knowledge base powered by local AI, bridging the gap between ephemeral inquiry and structured knowledge.


## Stealth & Behavioral Resilience

The scraper employs advanced behavioral modeling to achieve 1:1 parity with natural browsing, effectively bypassing Cloudflare and other anti-bot measures:

- **Human-Like Navigation**: Simulates organic mouse movement using Bézier curves and implements sinusoidal scrolling (acceleration/deceleration).
- **Session Warming**: Automatically "warms up" new browser sessions by visiting the home page and performing human-like browsing activity before accessing sensitive endpoints.
- **Navigator Spoofing**: Injects a robust initialization script to mask headless indicators, spoofing hardware properties (`deviceMemory`, `hardwareConcurrency`), and cleaning the `webdriver` property.
- **Strategic Fallback**: Automatically pivots between API interception, DOM scraping, and browser-native interactions (e.g., triggering the official Perplexity export UI) if detection is suspected.
- **Behavioral Jitter**: Injects randomized "reading" pauses and movement jitter to avoid signature-based detection.

## Key Features

- **Parallelized Extraction**: Leverages worker pools to extract multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience**: Automatically restores browser contexts and retries operations, ensuring continuity amidst environmental instability.
- **Advanced RAG (Retrieval-Augmented Generation)**: Engage in a cognitive dialogue with your history. The system employs intent analysis to synthesize broad summaries or pinpoint specific technical insights.
- **Semantic Vector Search**: Move beyond keyword matching. Locate information based on conceptual depth and semantic relevance.
- **Persistent State Tracking**: Frequent checkpoints allow the system to resume progress after any interruption.
- **Interactive Synthesis (REPL)**: A streamlined command-line interface for human-system synergy.

## Stealth & Resilience

The scraper is engineered to bypass sophisticated bot detection (e.g., Cloudflare) through several layers of defense:

- **Patchright Integration**: Uses a hardened browser fork that eliminates common automation fingerprints at the CDP and driver levels.
- **Strategy Fallback System**: If a high-speed strategy is blocked, the system automatically pivots to more natural, human-like behaviors (e.g., falling back from API calls to natural scrolling or DOM scraping).
- **Behavioral Jitter**: Implements randomized delays and human-like interaction patterns to remain undetected during long-running exports.
- **Vision-Based Bypass**: Detects Cloudflare challenges using visual analysis (1920x1080 screenshots) and leverages local AI to identify exact interaction coordinates, circumventing iframe-based honeypots.

## Environment Setup Guide

### 1. Install Node.js (The Engine)

We recommend using a version manager to install Node.js.

### 2. Install Ollama (The AI Intelligence)

1. Download and install Ollama from [ollama.ai](https://ollama.ai).
2. pull the required models:
   ```bash
   ollama pull nomic-embed-text
   ollama pull llama3.1
   ```

### 3. Download and Prepare the Project

```bash
npm install
npx playwright install chromium
```

## Configuration

Duplicate the template: `cp .env.example .env`

### Key Environment Variables

- **DISCOVERY_MODE**: Set the method for finding threads (`api`, `scroll`, `interaction`, `ai`). Defaults to `api`.
- **EXTRACTION_MODE**: Set the method for scraping thread content (`api`, `dom`, `native`, `ai`). Defaults to `api`.
- **HEADLESS**: Set to `true`, `false`, or `new`. Note that headful mode (`false`) is rarely needed due to our stealth implementation.
- **RATE_LIMIT_MS**: Base delay between operations to pace the scraper.

## Usage Guide

Launch the system:

```bash
# Start the system
npm run dev
```

## RAG Capabilities

The RAG modality is engineered for various levels of cognitive inquiry:

- **Broad Synthesis**: "Summarize all threads regarding distributed systems."
- **Granular Retrieval**: "Locate the specific TypeScript pattern I used for the worker pool."

## Architecture & Deep Dive

👉 **[ARCH.md](./ARCH.md)**

## Testing

```bash
# Execute unit-level verifications
npm run test:unit

# Execute integration-level verifications
npm run test:integration
```
