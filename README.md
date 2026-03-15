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
- [Environment Setup Guide](#environment-setup-guide)
  * [1. Install Node.js (The Engine)](#1-install-nodejs-the-engine)
  * [2. Install Ollama (The AI Intelligence)](#2-install-ollama-the-ai-intelligence)
  * [3. Download and Prepare the Project](#3-download-and-prepare-the-project)
- [Configuration](#configuration)
  * [Key Environment Variables](#key-environment-variables)
- [Usage Guide](#usage-guide)
- [Architecture & Deep Dive](#architecture--deep-dive)
- [Testing](#testing)

<!-- tocstop -->

---

## Introduction

This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files. It facilitates the emergence of a personal knowledge base powered by local AI, bridging the gap between ephemeral inquiry and structured knowledge.

## Stealth & Behavioral Resilience

The scraper employs advanced behavioral modeling to achieve 1:1 parity with natural browsing, effectively bypassing Cloudflare and other anti-bot measures:

- **Vision-Based Bypass**: Detects Cloudflare challenges using visual analysis (1920x1080 screenshots) and leverages local AI (**ministral-3**) to identify exact interaction coordinates, circumventing iframe-based honeypots.
- **Human-Like Navigation**: Simulates organic mouse movement using Bézier curves and implements sinusoidal scrolling (acceleration/deceleration).
- **Session Warming**: Automatically "warms up" new browser sessions by visiting the home page and performing human-like browsing activity before accessing sensitive endpoints.
- **Navigator Spoofing**: Injects a robust initialization script to mask headless indicators, spoofing hardware properties (`deviceMemory`, `hardwareConcurrency`), and cleaning the `webdriver` property.
- **Strategic Fallback**: Automatically pivots between API interception, DOM scraping, and browser-native interactions (e.g., triggering the official Perplexity export UI) if detection is suspected.

## Key Features

- **Parallelized Extraction**: Leverages worker pools to extract multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience**: Automatically restores browser contexts and retries operations, ensuring continuity amidst environmental instability.
- **Advanced RAG (Retrieval-Augmented Generation)**: Engage in a cognitive dialogue with your history. The system employs intent analysis to synthesize broad summaries or pinpoint specific technical insights (**cogito** model).
- **Semantic Vector Search**: Move beyond keyword matching. Locate information based on conceptual depth and semantic relevance.
- **Persistent State Tracking**: Frequent checkpoints allow the system to resume progress after any interruption.
- **Interactive Synthesis (REPL)**: A streamlined command-line interface for human-system synergy.

## Environment Setup Guide

If you are new to development or don't have the necessary tools installed, follow these steps to set up your environment.

### 1. Install Node.js (The Engine)

We recommend using a version manager to install Node.js. This allows you to easily switch versions and avoids permission issues.

- **Windows**: Download and run the latest installer from [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
- **macOS / Linux**: Install `nvm` by following the instructions at [nvm.sh](https://github.com/nvm-sh/nvm).

### 2. Install Ollama (The AI Intelligence)

1. Download and install Ollama from [ollama.ai](https://ollama.ai).
2. The system will automatically pull the required models on first run, but you can also do it manually:
   ```bash
   ollama pull nomic-embed-text
   ollama pull cogito
   ollama pull ministral-3
   ```

### 3. Download and Prepare the Project

1. Extract the project ZIP or clone the repository.
2. Open your terminal in the project folder and run:
   ```bash
   npm install
   npx playwright install chromium
   ```

## Configuration

Establish your environment by duplicating the template:
```bash
cp .env.example .env
```

### Key Environment Variables

- **DISCOVERY_MODE**: Set the method for finding threads (`api`, `scroll`, `interaction`, `ai`). Defaults to `api`.
- **EXTRACTION_MODE**: Set the method for scraping thread content (`api`, `dom`, `native`, `ai`). Defaults to `api`.
- **OLLAMA_MODEL**: Text reasoning model (default: `cogito`).
- **OLLAMA_VISION_MODEL**: Vision reasoning model (default: `ministral-3`).
- **HEADLESS**: Set to `true`, `false`, or `new`.

## Usage Guide

Launch the system:
```bash
# Start the system command
npm run dev
```

**Note**: The system requires at least **10GB of free disk space** to operate safely with local AI models. The application will check this requirement on startup.

## Architecture & Deep Dive

👉 **[ARCH.md](./ARCH.md)**

## Testing

```bash
# Execute unit verifications
npm run test:unit

# Execute integration verifications
npm run test:integration
```
