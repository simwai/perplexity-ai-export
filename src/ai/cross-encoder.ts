import { pipeline } from '@huggingface/transformers'

let crossEncoderInstance: any = null
let isInitializing = false

export async function getCrossEncoder() {
  if (crossEncoderInstance) return crossEncoderInstance
  if (isInitializing) return null

  isInitializing = true
  try {
    const pipe = await (pipeline as any)('feature-extraction', 'Xenova/ms-marco-MiniLM-L-6-v2')
    crossEncoderInstance = {
      tokenizer: pipe.tokenizer,
      model: pipe.model,
    }
    return crossEncoderInstance
  } catch {
    return null
  } finally {
    isInitializing = false
  }
}
