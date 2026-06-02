import { pipeline } from '@huggingface/transformers'

let crossEncoderInstance: any = null
let isEncoderInitializing = false

export async function getCrossEncoder() {
  if (crossEncoderInstance) return crossEncoderInstance
  if (isEncoderInitializing) return null

  isEncoderInitializing = true
  try {
    const CROSS_ENCODER_MODEL_IDENTIFIER = 'Xenova/ms-marco-MiniLM-L-6-v2'
    const transformerPipeline = await (pipeline as any)('feature-extraction', CROSS_ENCODER_MODEL_IDENTIFIER)

    crossEncoderInstance = {
      tokenizer: transformerPipeline.tokenizer,
      model: transformerPipeline.model,
    }
    return crossEncoderInstance
  } catch {
    return null
  } finally {
    isEncoderInitializing = false
  }
}
