export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SystemRequirementError extends AppError {}
export class CloudflareBypassError extends AppError {}
export class ExtractionError extends AppError {}
export class DiscoveryError extends AppError {}
export class OpenRouterError extends AppError {}
