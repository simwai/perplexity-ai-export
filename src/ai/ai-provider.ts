import { config } from '../utils/config.js'
import { OllamaClient } from './ollama-client.js'
import { OpenRouterClient } from './openrouter-client.js'

export interface AiProvider {
  generate(prompt: string, options?: { model?: string; temperature?: number }): Promise<string>
  generateWithVision(prompt: string, base64Image: string, options?: { model?: string; temperature?: number }): Promise<string>
  embed?(texts: string[]): Promise<number[][]>
  validate?(): Promise<void>
  ensureModelsAreReady?(): Promise<void>
}

export function getAiProvider(): AiProvider {
  if (config.llmSource === 'openrouter') {
    return new OpenRouterClient() as unknown as AiProvider
  }
  return new OllamaClient() as unknown as AiProvider
}
