# Debugging

Set `DEBUG=true` to enable verbose debug logging. When disabled, only warnings and errors are emitted.

## Log files

| File | When it is written | What is logged |
| --- | --- | --- |
| `debug/main-log-<timestamp>.txt` | `DEBUG=true` | Main application log, including redacted debug/info/warn/error messages |
| `debug/http-req-res-log-<timestamp>.txt` | `DEBUG=true` | HTTP request and response metadata for Perplexity API calls; prompt bodies are redacted; sensitive headers/query params are redacted |
| `debug/api-diagnostics.jsonl` | `DEBUG=true` | JSONL entries for unexpected API response shapes and Zod validation failures |

## VS Code debug workflow

1. Open the project in VS Code.
2. Open the Run and Debug view (`Ctrl+Shift+D` / `Cmd+Shift+D`).
3. Select **Debug REPL (verbose)** from the configuration dropdown.
4. Press `F5` to start debugging.

This configuration sets `DEBUG=true` automatically and runs `pnpm run type-check` before launching, so type errors surface before the debugger attaches.

If you prefer to run the app without the debugger, use the existing **Launch (tsx)** configuration in `.vscode/launch.json` from the Run and Debug view.

## Notes

- The main logger redacts sensitive keys such as `token`, `secret`, `authorization`, `cookie`, `password`, `apiKey`, `accessToken`, and `bearer`.
- HTTP logging records request method, URL, headers, and body, plus response status, headers, and body. JSON responses are logged in full unless the request looks like a prompt submission, in which case the body is replaced with `[PROMPT REDACTED]`.
- API diagnostics capture malformed shapes and Zod issue paths to help maintain resilience against API drift without storing raw prompts or credentials.
