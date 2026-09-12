---
tags: ai-agents, mcp, tools
---

# AI Agents

This document covers AI agent architectures, patterns, and implementations.

## Overview

AI agents are autonomous systems that can perceive their environment, reason about it, and take actions to achieve goals. They combine:

- **LLM reasoning** for planning and decision-making
- **Tool use** for interacting with external systems
- **Memory** for maintaining context across interactions
- **Goal-oriented behavior** for autonomous task completion

## Key Patterns

### ReAct (Reasoning + Acting)

The ReAct pattern interleaves reasoning traces with action execution:

```
Thought: I need to find the current weather
Action: search_web("weather today")
Observation: Sunny, 72°F
Thought: The weather is nice
```

See [[tool-calling]] for implementation details.

### Plan-and-Execute

Separates planning from execution for complex multi-step tasks:

1. **Planner** creates a step-by-step plan
2. **Executor** carries out each step
3. **Reviewer** validates results

### Multi-Agent Systems

Multiple specialized agents collaborate:

- **Researcher** gathers information
- **Coder** writes implementation
- **Reviewer** validates quality

## Frameworks

- **LangGraph** - Stateful, cyclic agent graphs
- **AutoGen** - Multi-agent conversations
- **CrewAI** - Role-based agent teams
- **Agents SDK** - Cloudflare's durable agents

## Memory Strategies

- **Short-term**: Conversation history in context window
- **Long-term**: Vector stores for semantic retrieval
- **Episodic**: Specific interaction memories
- **Semantic**: Extracted facts and knowledge

See [[mcp-server]] for model context protocol integration.

## References

- [ReAct Paper](https://arxiv.org/abs/2210.03629)
- [Generative Agents](https://arxiv.org/abs/2304.03442)