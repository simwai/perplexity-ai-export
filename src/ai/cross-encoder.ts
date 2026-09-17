import { logger } from '../utils/logging/logger.js'
import { errorMessageOf } from '../utils/extract-error-message.js'
import { from, ok, type Result } from 'super-result'

interface CrossEncoderInstance {
  tokenizer: {
    (
      text: string[],
      options?: { text_pair?: string[]; padding?: boolean; truncation?: boolean }
    ): Promise<{ input_ids: number[][]; attention_mask: number[][] }>
  }
  model: {
    (inputs: {
      input_ids: number[][]
      attention_mask: number[][]
    }): Promise<{ logits: { data: Float32Array } }>
  }
}

class CrossEncoder {
  private static instance: CrossEncoderInstance | null = null
  private static loading = false

  static async getInstance(): Promise<Result<CrossEncoderInstance | null, Error>> {
    if (CrossEncoder.instance) {
      return ok(CrossEncoder.instance)
    }

    if (CrossEncoder.loading) {
      while (CrossEncoder.loading) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return ok(CrossEncoder.instance)
    }

    CrossEncoder.loading = true
    const result = await CrossEncoder.loadCrossEncoderInstance()
    CrossEncoder.loading = false

    if (!result.ok) {
      logger.warn(`Failed to load cross-encoder: ${errorMessageOf(result.error)}`)
    }
    return result
  }

  private static async loadCrossEncoderInstance(): Promise<
    Result<CrossEncoderInstance | null, Error>
  > {
    const importResult = await from(import('@huggingface/transformers'))
    if (!importResult.ok) {
      logger.warn(`Failed to load transformers: ${errorMessageOf(importResult.error)}`)
      return ok(null)
    }
    const transformers = importResult.value
    if (!transformers) {
      return ok(null)
    }

    const { AutoTokenizer, AutoModelForSequenceClassification } = transformers

    const tokenizer = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
    const model = await AutoModelForSequenceClassification.from_pretrained(
      'Xenova/ms-marco-MiniLM-L-6-v2',
      { dtype: 'int8' }
    )

    CrossEncoder.instance = { tokenizer, model }
    return ok(CrossEncoder.instance)
  }

  static resetForTesting(): void {
    CrossEncoder.instance = null
    CrossEncoder.loading = false
  }
}

export async function getCrossEncoder(): Promise<Result<CrossEncoderInstance | null, Error>> {
  return CrossEncoder.getInstance()
}
