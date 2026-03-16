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
  * [1. Install Node.js](#1-install-nodejs)
  * [2. Setup AI Provider](#2-setup-ai-provider)
    + [Option A: Ollama (Local - Recommended)](#option-a-ollama-local---recommended)
    + [Option B: OpenRouter (Cloud)](#option-b-openrouter-cloud)
  * [3. Prepare the Project](#3-prepare-the-project)
- [Configuration](#configuration)
- [Usage Guide](#usage-guide)
- [Architecture & Deep Dive](#architecture--deep-dive)
- [Testing](#testing)

<!-- tocstop -->

---

## Introduction

This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files. It facilitates the emergence of a personal knowledge base powered by local or cloud AI.

## Stealth & Behavioral Resilience

The scraper employs advanced behavioral modeling to bypass Cloudflare and Turnstile challenges:

- **Structural Interaction**: Targets the internal Turnstile widget structure directly, monitoring response tokens to ensure bypass integrity.
- **Vision-Based Fallback**: Captures 1920x1080 screenshots and leverages AI reasoning to identify exact interaction coordinates if structural methods fail.
- **Human-Like Navigation**: Simulates organic mouse movement using Bézier curves and implements sinusoidal scrolling.
- **Session Warming**: Establishes browser reputation by visiting the home page and simulating browsing before accessing sensitive data.
- **Navigator Spoofing**: Injects scripts to purge `navigator.webdriver` and spoof high-end hardware profiles.

## Key Features

- **Parallelized Extraction**: Leverages worker pools for high-velocity data retrieval.
- **Advanced RAG**: Engage in a cognitive dialogue with your history using local or cloud LLMs.
- **Multi-Strategy Scraping**: 8 distinct strategies for discovery and extraction with intelligent auto-fallback.

## Environment Setup Guide

### 1. Install Node.js

Ensure you have **Node.js 20+** installed. We recommend [nvm](https://github.com/nvm-sh/nvm).

### 2. Setup AI Provider

#### Option A: Ollama (Local - Recommended)
1. Install [Ollama](https://ollama.ai).
2. The system will auto-pull models, but you can do it manually:
```bash
ollama pull nomic-embed-text
ollama pull deepseek-r1:7b
ollama pull qwen3.5:4b
```

#### Option B: OpenRouter (Cloud)
1. Get an API key from [OpenRouter](https://openrouter.ai).
2. Set `LLM_SOURCE=openrouter` and your key in `.env`.

### 3. Prepare the Project

```bash
# 1. Install dependencies
npm install

# 2. Install browser
npx playwright install chromium

# 3. Setup environment
cp .env.example .env
```

## Configuration

Edit your `.env` file to customize behavior:

| Variable | Description |
|----------|-------------|
| **LLM_SOURCE** | `ollama` or `openrouter` |
| **LLM_RAG_MODEL** | Text reasoning model (default: `cogito`) |
| **LLM_VISION_MODEL** | Vision model (default: `ministral-3`) |
| **DISCOVERY_MODE** | `api`, `scroll`, `interaction`, `ai` |
| **EXTRACTION_MODE** | `api`, `dom`, `native`, `ai` |

## Usage Guide

Launch the system:
```bash
# Start system command
npm run dev
```

> **Note**: Local AI requires at least **10GB of free disk space**. The application will verify this on startup.

## Architecture & Deep Dive

👉 **[ARCH.md](./ARCH.md)**

## Testing

```bash
# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration
```
