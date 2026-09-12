---
tags: mcp, ai-agents, protocol
---

# MCP Server

Model Context Protocol (MCP) server implementation and usage patterns.

## What is MCP?

MCP is an open protocol that standardizes how applications provide context to LLMs. It defines:

- **Resources** - Data the model can read (files, database rows, API responses)
- **Tools** - Functions the model can call (search, calculate, mutate)
- **Prompts** - Reusable prompt templates

## Server Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   MCP       │────▶│  Resources  │
│  (Claude,   │     │  Server     │     │  / Tools    │
│   Custom)   │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Implementation

### TypeScript (Cloudflare Workers)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

export class MyMcpAgent extends McpAgent {
  async init() {
    this.server.resource("config", "config://app", async (uri) => ({
      text: JSON.stringify(await this.env.CONFIG.get("app")),
    }));

    this.server.tool("search", "Search the web", { query: z.string() }, async ({ query }) => ({
      text: await searchWeb(query),
    }));
  }
}
```

See [[ai-agents]] for agent integration patterns.

## Transport Options

- **stdio** - Local process communication
- **SSE** - Server-sent events for web clients
- **WebSocket** - Bidirectional for real-time
- **HTTP** - Request/response for serverless

## Security

- Validate all tool inputs with Zod schemas
- Rate limit resource access
- Authenticate clients via tokens
- Sanitize resource content

## References

- [MCP Specification](https://modelcontextprotocol.io)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)