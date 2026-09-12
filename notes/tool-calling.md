---
tags: ai-agents, tools, function-calling
---

# Tool Calling

Function calling patterns for AI agents and LLM applications.

## Overview

Tool calling (function calling) enables LLMs to invoke external functions by generating structured JSON arguments. The model decides *which* tool to call and *what* arguments to pass.

## OpenAI Function Calling Format

```json
{
  "name": "search_web",
  "description": "Search the web for information",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" }
    },
    "required": ["query"]
  }
}
```

## Tool Execution Flow

```
User Query
    │
    ▼
LLM decides to call tool
    │
    ▼
Generate function call JSON
    │
    ▼
Execute function (sandboxed)
    │
    ▼
Return result to LLM
    │
    ▼
LLM generates final response
```

## Best Practices

### 1. Clear Descriptions

```typescript
// Good: Specific and actionable
"description": "Search the web for current information. Returns top 5 results with snippets."

// Bad: Vague
"description": "Search for things."
```

### 2. Strict Schemas

Use Zod for runtime validation:

```typescript
const searchSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).default(5),
});
```

### 3. Error Handling

```typescript
try {
  const result = await tool.execute(args);
  return { success: true, data: result };
} catch (error) {
  return { success: false, error: error.message };
}
```

### 4. Sandboxing

- Execute untrusted code in isolated environments
- Limit execution time and memory
- Restrict filesystem and network access

See [[ai-agents]] for agent integration with tools.

## Common Tool Categories

| Category | Examples |
|----------|----------|
| Search | Web search, documentation lookup |
| Data | Database queries, API calls |
| Code | Execution, linting, formatting |
| Files | Read, write, list, search |
| Browser | Navigate, click, extract |

## Parallel Tool Calls

Models can call multiple tools simultaneously:

```json
{
  "tool_calls": [
    { "name": "search", "arguments": { "query": "weather" } },
    { "name": "get_time", "arguments": { "timezone": "UTC" } }
  ]
}
```

Execute in parallel for latency optimization.

## References

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/claude/docs/tool-use)