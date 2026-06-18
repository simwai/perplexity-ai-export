# Agent Instructions

## Building the Executable
The project uses `caxa` to build a self-contained executable. The build process is orchestrated by `scripts/build-exe.js`.

### Key Features:
- **Self-contained:** Bundles Node.js, native modules (onnxruntime), and external binaries (ripgrep, chromium).
- **Portable Resolution:** Uses an esbuild banner to set environment variables (`PLAYWRIGHT_BROWSERS_PATH`, `RIPGREP_PATH`) at runtime, pointing to internal folders within the extracted executable environment.
- **Symlink Resilience:** Native modules are copied directly from the `.pnpm` store to ensure they are available even if the original `node_modules` structure uses symlinks.

### Running the build:
```bash
pnpm run build:exe
```

## Coding Standards
- No semicolons.
- Modern TypeScript ESM.
- Descriptive naming (Uncle Bob style).
- No cryptic abbreviations.
