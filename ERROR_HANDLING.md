# Error Handling System

This project uses a centralized and standardized error handling system.

## Core Components

- **ErrorBus**: A central event emitter (`src/utils/error-bus.ts`) that handles error reporting and rethrowing.
- **ErrorMessages**: A registry (`src/utils/error-messages.ts`) containing all user-facing error strings.
- **Custom Errors**: Specific error classes defined within modules to allow for granular error catching.

## Usage Patterns

### Rethrowing with Metadata

```typescript
throw errorBus.raise(MyModule.SpecificError, ErrorMessages.MyModule.OperationFailed, originalError)
```

### Reporting without Stopping

```typescript
errorBus.report(error, { message: ErrorMessages.MyModule.NonCriticalFailure })
```

## Error Message Registry

All error messages are managed in `src/utils/error-messages.ts`. This allows for:
- Consistency across the codebase.
- Easy localization or modification of messages.
- Clear overview of all possible error states.
